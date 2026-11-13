// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PP-OCRv5 mobile detection + recognition on ONNX Runtime, WebGPU first
 * (spike 05, Devanagari: 8/10 exact, CER 0.0192, 37.6 frames/s on the M5 Max;
 * nine recogniser nodes stay on the CPU inside the WebGPU session, which is
 * still the GPU route). The runtime logs a CPU fallback when the WebGPU
 * session can't be created. Apple Vision reads no Devanagari (spike 05), so
 * the Devanagari model is the Hindi path, and the Hindi line of a mixed
 * frame; the Latin model reads Latin text where there is no Apple Vision
 * (IX-O7). Which recogniser and charset: `models.ts`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { OcrFailed, OcrUnavailable, VisionModelMissing } from '../../errors';
import type { OnnxRuntime, OnnxSession } from '../../onnx/ort';
import { baseLanguage, clampBox, normaliseText, scriptOf } from '../text';
import type { OcrEngine, OcrFrame, OcrObservation, OcrPage } from '../types';
import { ctcDecodeBatch } from './ctc';
import { dbBoxes, mergeLines } from './db';
import { PADDLE_DEVANAGARI, type PaddleModel } from './models';
import { cropRgb, detTensor, recTensor, recWidth, type Rgb } from './preprocess';

/** The ONNX Runtime component every PP-OCR model depends on (the manifest's `dependencies`). */
const ONNXRUNTIME_COMPONENT = 'onnxruntime';

export const PADDLE_ENGINE = 'ppocr-v5' as const;
/** The component that holds the detector, recogniser and charset. */
export const PADDLE_COMPONENT = PADDLE_DEVANAGARI.component;
export const PADDLE_LANGUAGES = ['hi'] as const;

export interface PaddleOcrOptions {
  readonly onnx: OnnxRuntime;
  /** The installed component's folder. */
  readonly modelDir: string;
  /** Line crops per recogniser run, at most (crops of one width share a run). Default 8. */
  readonly recBatch?: number;
}

interface Loaded {
  readonly det: OnnxSession;
  readonly rec: OnnxSession;
  readonly charset: readonly string[];
}

/** Spike 05's Hindi engine. */
export function createPaddleDevanagariOcr(options: PaddleOcrOptions): OcrEngine {
  return createPaddleOcr({ ...options, model: PADDLE_DEVANAGARI });
}

export function createPaddleOcr(options: PaddleOcrOptions & { readonly model: PaddleModel }): OcrEngine {
  const { model } = options;
  const serves = new Set(model.languages);
  let loading: Promise<Loaded | TaalcutError> | undefined;
  const load = async (signal?: AbortSignal): AsyncResult<Loaded> => {
    loading ??= open(options, signal).then((r) => (r.ok ? r.value : r.error));
    const loaded = await loading;
    if ('det' in loaded) return ok(loaded);
    loading = undefined;
    return err(loaded);
  };

  return {
    async capabilities() {
      return ok({ scripts: [...model.scripts], languages: [...model.languages] });
    },
    async recognize(frames, { languages, signal, meter }) {
      if (signal?.aborted) return err(CancelledError());
      const asked = [...new Set(languages.map(baseLanguage))];
      if (asked.length > 0 && !asked.some((language) => serves.has(language))) {
        return err(OcrUnavailable({ language: asked[0] ?? '' }));
      }
      if (frames.length === 0) return ok([]);
      const sessions = await load(signal);
      if (!sessions.ok) return sessions;
      const started = performance.now();
      const pages: OcrPage[] = [];
      for (const frame of frames) {
        if (signal?.aborted) return err(CancelledError());
        const page = await readFrame(sessions.value, model, frame, options.recBatch ?? 8, signal);
        if (!page.ok) return page;
        pages.push(page.value);
      }
      const took = performance.now() - started;
      meter?.request({
        engine: model.meterEngine,
        frames: frames.length,
        languages: asked.length,
        encodeMs: 0,
        requestMs: took,
        engineMs: took,
        parseMs: 0,
      });
      return ok(pages);
    },
    async close() {
      const loaded = loading ? await loading : undefined;
      loading = undefined;
      if (loaded && 'det' in loaded) {
        await loaded.det.release();
        await loaded.rec.release();
      }
    },
  };
}

async function open(
  options: PaddleOcrOptions & { readonly model: PaddleModel },
  signal?: AbortSignal,
): AsyncResult<Loaded> {
  const { model } = options;
  const charset = await readCharset(join(options.modelDir, 'charset.json'), model);
  if (!charset.ok) return charset;
  const det = await options.onnx.openSession(join(options.modelDir, 'det', 'inference.onnx'), {
    operation: 'vision.ocr',
    ...(signal ? { signal } : {}),
  });
  if (!det.ok) return err(unavailable(det.error, model));
  const rec = await options.onnx.openSession(join(options.modelDir, 'rec', 'inference.onnx'), {
    operation: 'vision.ocr',
    ...(signal ? { signal } : {}),
  });
  if (!rec.ok) {
    await det.value.release();
    return err(unavailable(rec.error, model));
  }
  return ok({ det: det.value, rec: rec.value, charset: charset.value });
}

/**
 * No runtime or no model file: the model can't read here until its component (or ONNX Runtime) is installed, which
 * the library waits for (UX3-IDX; it was `vision.ocr_unavailable`, a failure). Anything else is a failure.
 */
function unavailable(error: TaalcutError, model: PaddleModel): TaalcutError {
  if (error.code === 'core.cancelled') return error;
  const detail = error.detail ? { detail: error.detail } : {};
  if (error.code === 'vision.embedder_unavailable' || error.code === 'media.onnx_unavailable')
    return VisionModelMissing({ component: ONNXRUNTIME_COMPONENT }, detail);
  if (/no such file|ENOENT|not exist/i.test(error.detail ?? ''))
    return VisionModelMissing({ component: model.component }, detail);
  return error;
}

async function readCharset(path: string, model: PaddleModel): AsyncResult<readonly string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(VisionModelMissing({ component: model.component }, { detail: `charset: ${detail}` }));
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.length === model.charsetSize &&
    parsed.every((entry) => typeof entry === 'string' && entry.length > 0 && entry !== ' ');
  if (!valid)
    return err(OcrFailed(undefined, { detail: `charset.json is not ${model.charsetSize} characters` }));
  return ok(parsed as string[]);
}

async function readFrame(
  sessions: Loaded,
  model: PaddleModel,
  frame: OcrFrame,
  recBatch: number,
  signal: AbortSignal | undefined,
): AsyncResult<OcrPage> {
  const image: Rgb = { data: frame.rgb, width: frame.width, height: frame.height };
  const input = detTensor(image);
  const detName = sessions.det.inputNames[0] ?? 'x';
  const detOut = await sessions.det.run({ [detName]: input }, signal);
  if (!detOut.ok) return detOut;
  const map = detOut.value[sessions.det.outputNames[0] ?? ''] ?? Object.values(detOut.value)[0];
  if (!map) return err(OcrFailed(undefined, { detail: 'detector returned no output' }));
  const dims = map.dims;
  const mapHeight = dims.length === 4 ? (dims[2] ?? input.height) : (dims[1] ?? input.height);
  const mapWidth = dims.length === 4 ? (dims[3] ?? input.width) : (dims[2] ?? input.width);
  const lines = mergeLines(
    dbBoxes({ data: map.data, width: mapWidth, height: mapHeight }, frame.width, frame.height),
  );

  const crops: { crop: Rgb; box: (typeof lines)[number] }[] = [];
  for (const line of lines) {
    const crop = cropRgb(image, line.x0, line.y0, line.x1, line.y1);
    if (crop) crops.push({ crop, box: line });
  }
  const read: (OcrObservation | undefined)[] = [];
  const recName = sessions.rec.inputNames[0] ?? 'x';
  for (const batch of recBatches(
    crops.map((item) => recWidth(item.crop).padded),
    recBatch,
  )) {
    const out = await sessions.rec.run(
      { [recName]: recTensor(batch.flatMap((i) => crops[i]?.crop ?? [])) },
      signal,
    );
    if (!out.ok) return out;
    const logits = out.value[sessions.rec.outputNames[0] ?? ''] ?? Object.values(out.value)[0];
    if (!logits) return err(OcrFailed(undefined, { detail: 'recogniser returned no output' }));
    let decoded;
    try {
      decoded = ctcDecodeBatch(logits.data, logits.dims, sessions.charset);
    } catch (cause) {
      return err(OcrFailed(undefined, { detail: cause instanceof Error ? cause.message : String(cause) }));
    }
    decoded.forEach((line, n) => {
      const at = batch[n];
      const item = at === undefined ? undefined : crops[at];
      if (at !== undefined && item) read[at] = observation(line, item.box, frame, model);
    });
  }
  const observations = read.filter((o): o is OcrObservation => o !== undefined);
  return ok({ frame: frame.index, observations });
}

/**
 * The crops' recogniser runs, as indices, PaddleOCR's own way: crops sorted by padded width (stable, so detection
 * order within a width), then `size` a run, each run padded to its widest. A frame with up to `size` lines runs as
 * one batch, as before; on a busier frame a short line no longer pads to a long one's width in its run. The engine
 * puts the readings back in detection order.
 */
export function recBatches(widths: readonly number[], size: number): number[][] {
  const order = widths.map((_, i) => i).sort((a, b) => (widths[a] ?? 0) - (widths[b] ?? 0));
  const step = Math.max(1, size);
  const runs: number[][] = [];
  for (let start = 0; start < order.length; start += step) runs.push(order.slice(start, start + step));
  return runs;
}

function observation(
  line: { readonly text: string; readonly confidence: number },
  box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  frame: OcrFrame,
  model: PaddleModel,
): OcrObservation | undefined {
  const text = normaliseText(line.text);
  if (!text) return undefined;
  const script = scriptOf(text);
  return {
    text,
    box: clampBox({
      x: box.x0 / frame.width,
      y: box.y0 / frame.height,
      width: (box.x1 - box.x0) / frame.width,
      height: (box.y1 - box.y0) / frame.height,
    }),
    confidence: Math.min(1, Math.max(0, line.confidence)),
    script,
    ...(script === model.scriptLanguage?.script ? { language: model.scriptLanguage.language } : {}),
    engine: PADDLE_ENGINE,
  };
}
