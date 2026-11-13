// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Apple Vision text recognition through the mac helper (`ocr.recognize`,
 * native/mac-helper/SPEC.md). Vision is the GPU/Neural Engine path for Latin
 * text and has no CPU twin here: a helper failure is `vision.ocr_failed`,
 * never a silent switch to another engine. Boxes arrive in Vision's own space
 * (normalised, origin lower left) and are converted here, once, to core's
 * top-left `NormalisedBox`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError, type TextScript } from '@taalcut/core';
import type { JsonLineRequestOptions, JsonLineSidecar, JsonValue } from '@taalcut/media';
import { z } from 'zod';
import { OcrFailed, OcrUnavailable } from '../errors';
import { encodeBmp } from '../media/bmp';
import { encodePng } from '../media/png';
import { KEEPALIVE_OCR_VERSION, readySchema, requestTiming, warmUp, type Timing } from './apple-vision-wire';
import { inFlight } from './in-flight';
import type { OcrMeter } from './meter';
import { requestRanges } from './requests';
import { baseLanguage, clampBox, normaliseText, scriptOf } from './text';
import type { OcrCapabilities, OcrEngine, OcrFrame, OcrObservation, OcrPage, OcrQuad } from './types';

export const APPLE_VISION_ENGINE = 'apple-vision' as const;
/** The helper takes at most 16 images per request. */
export const HELPER_BATCH = 16;
/** Vision's documented default; set explicitly because the two APIs read their defaults back differently. */
const MINIMUM_TEXT_HEIGHT = 1 / 32;
/**
 * Requests in flight by default (IX-O6): the helper runs two at a time, and two kept it busy at about 1.7 times
 * the frames per second of one, with identical pages (380 ix-v1 frames, three runs: 65–69 ms a frame against
 * 112–122).
 */
export const DEFAULT_IN_FLIGHT = 2;
/**
 * BMP by default (IX-O6): a byte copy instead of deflate. 48 720p frames, three rounds each: PNG encoding took
 * 4.5–4.6 s, BMP 0.13 s; Vision's own time and the pages were the same.
 */
export const DEFAULT_TRANSFER = 'bmp' as const;

/** How Vision reads (the helper's `ocr.recognize` options, native/mac-helper/SPEC.md). */
export interface AppleVisionRecognition {
  readonly level: 'accurate' | 'fast';
  readonly languageCorrection: boolean;
  readonly autoDetectLanguage: boolean;
  /** Smallest text height Vision looks for, as a share of the image height. */
  readonly minimumTextHeight: number;
}

/** Today's reading: accurate, corrected, languages detected, Vision's default minimum height. */
export const DEFAULT_RECOGNITION: AppleVisionRecognition = {
  level: 'accurate',
  languageCorrection: true,
  autoDetectLanguage: true,
  minimumTextHeight: MINIMUM_TEXT_HEIGHT,
};

export interface AppleVisionOptions {
  /** A folder inside one of the helper's `--allow-root`s; frames without a path are written here briefly. */
  readonly tempDir: string;
  /**
   * The most one request (up to 16 frames) may take. A helper that keeps alive (OCR v2, apple-vision-wire.ts):
   * default 10 minutes, and the request gives up sooner only when the keepalive stops for `stallMs`. An older
   * helper: default 60 s.
   */
  readonly timeoutMs?: number;
  /** With a helper that keeps alive: how long without a keepalive before a request gives up. Default 30 s. */
  readonly stallMs?: number;
  /** Default DEFAULT_RECOGNITION. */
  readonly recognition?: AppleVisionRecognition;
  /**
   * Requests sent at once when a call holds more frames (the helper runs two OCR requests at a time and queues
   * the rest). A call is cut into requests of at most 16 frames, as many as fill whole rounds of this many and as
   * equal as possible (requests.ts). Default DEFAULT_IN_FLIGHT.
   */
  readonly inFlight?: number;
  /** How frames without a path reach the helper: PNG (deflate) or BMP (a byte copy). Default DEFAULT_TRANSFER. */
  readonly transfer?: 'png' | 'bmp';
}

/** Base languages written in Latin script among Vision's list (spike 05: 30 languages, 19 Latin; macOS 27.2 adds fi). */
const LATIN_LANGUAGES = new Set([
  'fi',
  'en',
  'fr',
  'it',
  'de',
  'es',
  'pt',
  'vi',
  'tr',
  'id',
  'cs',
  'da',
  'nl',
  'no',
  'nn',
  'nb',
  'ms',
  'pl',
  'ro',
  'sv',
]);

const languagesSchema = z.array(z.string().min(1).max(35)).max(200);
const listSchema = z.object({ accurate: languagesSchema }).loose();
const resultSchema = z.object({
  images: z.array(
    z.object({
      /** Vision's own time for this image (the helper measures it). */
      ms: z.number().nonnegative().optional(),
      observations: z.array(
        z.object({
          text: z.string(),
          confidence: z.number(),
          language: z.string().optional(),
          box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
          /** FIX-SIGN: the text's corners (a helper before FIX-SIGN sends none). */
          quad: z
            .array(z.object({ x: z.number(), y: z.number() }))
            .length(4)
            .optional(),
        }),
      ),
    }),
  ),
});
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** What the ready line says this helper does: its languages, and whether it keeps alive (OCR v2). */
interface Served {
  readonly languages: readonly string[];
  readonly keepalive: boolean;
}

export function createAppleVisionOcr(sidecar: JsonLineSidecar, options: AppleVisionOptions): OcrEngine {
  let supported: Promise<Served | TaalcutError> | undefined;
  const served = () => (supported ??= readServed(sidecar).then((r) => (r.ok ? r.value : r.error)));
  const languages = async (): Promise<readonly string[] | TaalcutError> => {
    const got = await served();
    return 'languages' in got ? got.languages : got;
  };
  const keepalive = async () => {
    const got = await served();
    return 'keepalive' in got && got.keepalive;
  };
  const timing: Timing = {
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.stallMs !== undefined ? { stallMs: options.stallMs } : {}),
  };

  return {
    async capabilities() {
      const list = await languages();
      if (!Array.isArray(list)) {
        supported = undefined;
        return err(list as TaalcutError);
      }
      return ok(capabilitiesOf(list));
    },
    async recognize(frames, { languages: wanted, signal, meter }) {
      if (signal?.aborted) return err(CancelledError());
      if (frames.length === 0) return ok([]);
      const list = await languages();
      if (!Array.isArray(list)) {
        supported = undefined;
        return err(list as TaalcutError);
      }
      const served = new Set(list.map(baseLanguage));
      const asked = [...new Set(wanted.map(baseLanguage))];
      const send = asked.filter((language) => served.has(language));
      if (asked.length > 0 && send.length === 0) return err(OcrUnavailable({ language: asked[0] ?? '' }));

      // The frames' folder, made once by whichever batch writes first.
      let dir: Promise<string> | undefined;
      const folder = () => (dir ??= mkdtemp(join(options.tempDir, 'ocr-')));
      const parallel = options.inFlight ?? DEFAULT_IN_FLIGHT;
      const ranges = requestRanges(frames.length, parallel, HELPER_BATCH);
      const read = async (n: number): AsyncResult<OcrPage[]> => {
        const [start, end] = ranges[n] ?? [0, 0];
        const batch = frames.slice(start, end);
        const encodeStarted = performance.now();
        const paths = await writeBatch(batch, start, folder, options.transfer ?? DEFAULT_TRANSFER);
        const encodeMs = performance.now() - encodeStarted;
        return recognizeBatch(
          sidecar,
          { frames: batch, paths, languages: send, encodeMs },
          { options, wait: requestTiming(await keepalive(), timing) },
          signal,
          meter,
        );
      };
      try {
        const pages = await inFlight(ranges.length, parallel, read);
        return pages.ok ? ok(pages.value.flat()) : pages;
      } finally {
        if (dir) await rm(await dir, { recursive: true, force: true });
      }
    },
    async warm() {
      const got = await served();
      if (!('keepalive' in got)) {
        supported = undefined;
        return err(got);
      }
      return warmUp(sidecar, got.keepalive, timing);
    },
  };
}

/**
 * The helper reads files: a frame with a path is passed as is, the rest are written to the call's folder. A batch is
 * encoded in one go and its files written together, so its request waits on the event loop twice, not twice per
 * frame: this process runs other work between those turns (PP-OCR's preprocessing beside a Hindi read, another
 * file's job), and frame by frame a Hindi file's transfer took 2.3–3.6 s against 0.1 s (IX3-O2 study).
 */
async function writeBatch(
  batch: readonly OcrFrame[],
  first: number,
  folder: () => Promise<string>,
  transfer: 'png' | 'bmp',
): Promise<string[]> {
  const dir = batch.every((frame) => frame.path) ? '' : await folder();
  const files = batch.map((frame, k) =>
    frame.path
      ? { path: frame.path }
      : { path: join(dir, `${first + k}.${transfer}`), bytes: encodeFrame(frame, transfer) },
  );
  await Promise.all(files.flatMap((file) => (file.bytes ? [writeFile(file.path, file.bytes)] : [])));
  return files.map((file) => file.path);
}

function encodeFrame(frame: OcrFrame, transfer: 'png' | 'bmp'): Buffer {
  return transfer === 'bmp'
    ? encodeBmp(frame.rgb, frame.width, frame.height)
    : encodePng(frame.rgb, frame.width, frame.height, 3);
}

async function readServed(sidecar: JsonLineSidecar): AsyncResult<Served> {
  const ready = await sidecar.ready();
  if (!ready.ok) return err(mapError(ready.error, []));
  const parsed = readySchema.safeParse(ready.value);
  const keepalive = parsed.success && (parsed.data.serviceVersions?.['ocr'] ?? 1) >= KEEPALIVE_OCR_VERSION;
  if (parsed.success && parsed.data.ocr) return ok({ languages: parsed.data.ocr.languages, keepalive });
  const listed = await sidecar.request('ocr.languages', {});
  if (!listed.ok) return err(mapError(listed.error, []));
  const list = listSchema.safeParse(listed.value);
  if (!list.success) return err(OcrFailed(undefined, { detail: 'ocr.languages: unexpected reply' }));
  return ok({ languages: list.data.accurate, keepalive });
}

function capabilitiesOf(list: readonly string[]): OcrCapabilities {
  const scripts = new Set<TextScript>();
  for (const language of list) {
    const base = baseLanguage(language);
    if (LATIN_LANGUAGES.has(base)) scripts.add('latin');
    else if (base === 'hi' || base === 'mr' || base === 'ne' || base === 'sa') scripts.add('devanagari');
    else scripts.add('other');
  }
  return { scripts: [...scripts], languages: [...list] };
}

interface Batch {
  readonly frames: readonly OcrFrame[];
  readonly paths: readonly string[];
  readonly languages: readonly string[];
  /** Time spent writing the batch's frames. */
  readonly encodeMs: number;
}

async function recognizeBatch(
  sidecar: JsonLineSidecar,
  { frames, paths, languages, encodeMs }: Batch,
  { options, wait }: { readonly options: AppleVisionOptions; readonly wait: JsonLineRequestOptions },
  signal: AbortSignal | undefined,
  meter: OcrMeter | undefined,
): AsyncResult<OcrPage[]> {
  const recognition = options.recognition ?? DEFAULT_RECOGNITION;
  const params: JsonValue = {
    paths: [...paths],
    languages: [...languages],
    level: recognition.level,
    languageCorrection: recognition.languageCorrection,
    autoDetectLanguage: recognition.autoDetectLanguage,
    minimumTextHeight: recognition.minimumTextHeight,
  };
  const requested = performance.now();
  const reply = await sidecar.request('ocr.recognize', params, { ...wait, ...(signal ? { signal } : {}) });
  const requestMs = performance.now() - requested;
  if (signal?.aborted) return err(CancelledError());
  if (!reply.ok) return err(mapError(reply.error, languages));
  const parseStarted = performance.now();
  const parsed = resultSchema.safeParse(reply.value);
  if (!parsed.success || parsed.data.images.length !== frames.length) {
    return err(OcrFailed(undefined, { detail: 'ocr.recognize: unexpected reply shape' }));
  }
  const pages = parsed.data.images.map((image, i) => ({
    frame: frames[i]?.index ?? 0,
    observations: image.observations.flatMap((observation) => {
      const text = normaliseText(observation.text);
      if (!text) return [];
      return [toObservation(text, observation)];
    }),
  }));
  meter?.request({
    engine: APPLE_VISION_ENGINE,
    frames: frames.length,
    languages: languages.length,
    encodeMs,
    requestMs,
    engineMs: parsed.data.images.reduce((sum, image) => sum + (image.ms ?? 0), 0),
    parseMs: performance.now() - parseStarted,
  });
  return ok(pages);
}

function toObservation(
  text: string,
  observation: {
    confidence: number;
    language?: string;
    box: { x: number; y: number; width: number; height: number };
    quad?: { x: number; y: number }[] | undefined;
  },
): OcrObservation {
  const { x, y, width, height } = observation.box;
  // Vision's origin is the lower left; core's is the top left.
  const box = clampBox({ x, y: 1 - y - height, width, height });
  const corners = observation.quad?.map((point) => ({ x: point.x, y: 1 - point.y }));
  const language =
    observation.language && LANGUAGE_TAG.test(observation.language) ? observation.language : undefined;
  return {
    text,
    box,
    confidence: Math.min(1, Math.max(0, observation.confidence)),
    script: scriptOf(text),
    ...(language ? { language } : {}),
    ...(corners && corners.length === 4 ? { quad: corners as unknown as OcrQuad } : {}),
    engine: APPLE_VISION_ENGINE,
  };
}

function mapError(error: TaalcutError, languages: readonly string[]): TaalcutError {
  if (error.code === 'core.cancelled' || error.code === 'media.cancelled') return CancelledError();
  const helperCode =
    typeof error.params?.['helperCode'] === 'string' ? error.params['helperCode'] : undefined;
  if (helperCode === 'ocr.language_unsupported') {
    return OcrUnavailable({ language: languages[0] ?? '' }, error.detail ? { detail: error.detail } : {});
  }
  const detail = [helperCode ?? error.code, error.detail].filter(Boolean).join(': ');
  return OcrFailed(undefined, { detail: detail.slice(0, 500) });
}
