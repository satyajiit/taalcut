// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's media and vision analysers in the jobs process (templates
 * SPEC, "Breakdown pipeline"; ports in @taalcut/templates breakdown/ports.ts),
 * on media's plan-based primitives and vision's breakdown functions. Templates
 * may not import media, so the adapters live here. GPU first (ADR 0002):
 * decodes, scales and encodes go through media's VideoToolbox routes; the
 * filters with no GPU form (scdet, the contact sheet's tile) are reported once
 * as `compute.fallback`. A screen recording's reel rectangle comes from
 * crop-detect.ts (FFmpeg's cropdetect is GPL-only; the sidecar is LGPL).
 */
import { mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import {
  conform,
  fileParams,
  planNormalisation,
  probeMedia,
  runFfmpeg,
  sampleFrames,
  UnsupportedMedia,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import type { BreakdownMedia, BreakdownVision, OcrLine } from '@taalcut/templates';
import { detectReelCrop } from './crop-detect';
import {
  EmbeddingFailed,
  frameVectors,
  motionCurve,
  ocrFrames,
  ocrImage,
  probeSource,
  sceneFallback,
  sceneScoresOf,
  type OcrEngine,
  type OcrObservation,
  type VisionEmbedder,
} from '@taalcut/vision';

export interface AnalyserContext {
  /** FFmpeg and the shared fallback bookkeeping; resolved at the first step. */
  readonly media: () => AsyncResult<MediaContext>;
  readonly onFallback: (event: ComputeFallbackEvent) => void;
}

/** Embedding many frames at once holds them all in memory: this many per model call. */
const EMBED_CHUNK = 32;
/** The motion curve's samples a second inside a shot (templates SPEC: 10/s away from cuts). */
const MOTION_RATE = 10;
/** Luma is a mean over a small gray frame. */
const LUMA_SIZE = 64;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const unique = (frames: readonly number[]) =>
  [...new Set(frames.map((f) => Math.max(0, Math.floor(f))))].sort((a, b) => a - b);

/** Reports one CPU route per operation and process (ADR 0002: logged with its reason, once). */
function onceFallbacks(onFallback: AnalyserContext['onFallback']) {
  const reported = new Set<string>();
  return (operation: string, event: () => ComputeFallbackEvent) => {
    if (reported.has(operation)) return;
    reported.add(operation);
    onFallback(event());
  };
}

function tileFallback(): ComputeFallbackEvent {
  const choice = cpuFallback(
    'no_accelerator',
    'the contact sheet tiles small JPEG frames with FFmpeg scale, pad and tile; none has a GPU form for them',
  );
  if (choice.backend !== 'cpu') throw new Error('unreachable');
  return computeFallbackEvent('templates.contactSheet', ['videotoolbox', 'cpu'], choice.fallback);
}

interface Planned {
  readonly media: MediaContext;
  readonly plan: NormalisationPlan;
}

/**
 * Media's normalisation plan per file, made once (the reference, then the normalised copy): `use` runs on it,
 * or the probe's error comes back.
 */
function planCache(ctx: AnalyserContext) {
  const plans = new Map<string, NormalisationPlan>();
  const planOf = async (path: string, signal: AbortSignal): AsyncResult<Planned> => {
    const media = await ctx.media();
    if (!media.ok) return media;
    const known = plans.get(path);
    if (known) return ok({ media: media.value, plan: known });
    const probed = await probeMedia(path, media.value, { signal });
    if (!probed.ok) return probed;
    const plan = planNormalisation(probed.value);
    if (!plan.ok) return plan;
    plans.set(path, plan.value);
    return ok({ media: media.value, plan: plan.value });
  };
  return async <T>(path: string, signal: AbortSignal, use: (planned: Planned) => AsyncResult<T>) => {
    const planned = await planOf(path, signal);
    return planned.ok ? use(planned.value) : planned;
  };
}

/** The reference conformed (and cropped, for a screen recording) at the analysis width. */
async function conformReference(
  path: string,
  { plan, media }: Planned,
  options: Omit<Parameters<BreakdownMedia['normalise']>[1], 'rate'>,
): AsyncResult<{ readonly path: string; readonly frames: number }> {
  const { outPath, width, crop, signal } = options;
  // The picture is the crop when there is one (upright source pixels; media checks it).
  const w = Math.max(1, crop?.width ?? plan.facts.width);
  const h = Math.max(1, crop?.height ?? plan.facts.height);
  // `width` is the frame's width; media sizes by the long side.
  const longSide = even((width * Math.max(w, h)) / w);
  const made = await conform(path, plan, media, {
    out: outPath,
    maxLongSide: longSide,
    codec: 'h264',
    signal,
    ...(crop ? { crop } : {}),
  });
  return made.ok ? ok({ path: outPath, frames: made.value.frames }) : made;
}

/** One JPEG per frame (on the plan's grid) in `outDir`, from one decode. Paths in the order asked. */
async function writeFrames(
  path: string,
  planned: Planned,
  frames: readonly number[],
  options: { maxDimension: number; outDir: string; signal: AbortSignal },
): AsyncResult<readonly string[]> {
  const last = Math.max(0, planned.plan.frames - 1);
  const wanted = unique(frames.map((frame) => Math.min(frame, last)));
  await mkdir(options.outDir, { recursive: true });
  const images = new Map<number, Buffer>();
  const sampled = await sampleFrames(path, planned.plan, planned.media, {
    frames: wanted,
    size: options.maxDimension,
    format: 'jpeg',
    signal: options.signal,
    onFrame: (frame) => void images.set(frame.index, frame.data),
  });
  if (!sampled.ok) return sampled;
  const name = (frame: number) =>
    join(options.outDir, `frame-${String(frame).padStart(6, '0')}-${options.maxDimension}.jpg`);
  for (const frame of wanted) {
    const data = images.get(frame);
    if (!data) return err(UnsupportedMedia(fileParams(path), { detail: `frame ${frame} was not decoded` }));
    await writeFile(name(frame), data);
  }
  return ok(frames.map((frame) => name(Math.min(Math.max(0, Math.floor(frame)), last))));
}

export function breakdownMedia(ctx: AnalyserContext): BreakdownMedia {
  const withPlan = planCache(ctx);
  const fallback = onceFallbacks(ctx.onFallback);
  return {
    probe: (path, { signal }) =>
      withPlan(path, signal, async ({ plan }) => {
        const rate = plan.frameRate.output;
        const video = plan.kind === 'video';
        return ok({
          duration: video ? RationalTime.of(plan.frames, rate) : RationalTime.of(0, rate),
          rate,
          width: plan.facts.width,
          height: plan.facts.height,
          hasVideo: video,
          hasAudio: Boolean(plan.audio),
        });
      }),

    detectCrop: (path, { signal }) =>
      withPlan(path, signal, (planned) => detectReelCrop(path, planned, signal)),

    normalise: (path, options) =>
      withPlan(path, options.signal, (planned) => conformReference(path, planned, options)),

    extractFrames: (path, frames, { maxDimension, outDir, signal }) =>
      withPlan(path, signal, (planned) =>
        writeFrames(path, planned, frames, { maxDimension, outDir, signal }),
      ),

    // BRK1-GFX: raw RGB frames for reading an overlay's design (templates breakdown/overlay-design.ts).
    framePixels: (path, frames, { maxDimension, signal }) =>
      withPlan(path, signal, async ({ plan, media }) => {
        const last = Math.max(0, plan.frames - 1);
        const got = new Map<number, { frame: number; width: number; height: number; rgb: Uint8Array }>();
        const sampled = await sampleFrames(path, plan, media, {
          frames: unique(frames.map((frame) => Math.min(frame, last))),
          size: maxDimension,
          format: 'rgb24',
          signal,
          onFrame: ({ index, data, width, height }) =>
            void got.set(index, { frame: index, width, height, rgb: new Uint8Array(data) }),
        });
        if (!sampled.ok) return sampled;
        return ok(frames.flatMap((frame) => got.get(Math.min(frame, last)) ?? []));
      }),

    async contactSheet(images, layout, { outPath, signal }) {
      const media = await ctx.media();
      if (!media.ok) return media;
      fallback('templates.contactSheet', tileFallback);
      const tiles = `${outPath}.tiles`;
      await rm(tiles, { recursive: true, force: true });
      await mkdir(tiles, { recursive: true });
      try {
        // Our own JPEGs, numbered for one image-sequence input.
        await Promise.all(
          images.map((image, index) =>
            symlink(image, join(tiles, `${String(index + 1).padStart(4, '0')}.jpg`)),
          ),
        );
        const { tileWidth: w, tileHeight: h } = layout;
        const quality = Math.max(2, Math.min(31, Math.round((100 - layout.quality) / 6)));
        const run = await runFfmpeg(
          media.value,
          [
            ...['-y', '-framerate', '1', '-i', join(tiles, '%04d.jpg')],
            '-vf',
            `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,tile=${layout.columns}x${layout.rows}`,
            ...['-frames:v', '1', '-q:v', String(quality), outPath],
          ],
          // JPEG tiles to one JPEG, no video session: a stop keeps SIGTERM then SIGKILL (IX3-K2).
          { holdsVideoSession: false, signal, timeoutMs: 60_000 },
        );
        if (!run.ok) return run;
        return ok({ path: outPath, bytes: (await stat(outPath)).size });
      } finally {
        await rm(tiles, { recursive: true, force: true });
      }
    },

    lumaCurve: (path, { ranges, signal }) =>
      withPlan(path, signal, async ({ plan, media }) => {
        const frames = unique(
          ranges.flatMap(([start, end]) =>
            Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i),
          ),
        );
        if (frames.length === 0) return ok([]);
        const values: { frame: number; luma: number }[] = [];
        const sampled = await sampleFrames(path, plan, media, {
          frames,
          size: LUMA_SIZE,
          format: 'gray8',
          signal,
          onFrame: (frame) => {
            let sum = 0;
            for (const value of frame.data) sum += value;
            values.push({ frame: frame.index, luma: sum / Math.max(1, frame.data.length) / 255 });
          },
        });
        return sampled.ok ? ok(values) : sampled;
      }),
  };
}

export interface VisionAnalyserDeps extends AnalyserContext {
  readonly embedder: VisionEmbedder;
  readonly ocr: OcrEngine;
  /**
   * Called once when the embedder says its model isn't installed: installs the component (the user asked
   * for this breakdown; waiting for the download beats failing). Absent: the error stands.
   */
  readonly installEmbedder?: (signal: AbortSignal) => AsyncResult<unknown>;
}

const lineOf = (observation: OcrObservation): OcrLine => ({
  text: observation.text,
  box: observation.box,
  confidence: observation.confidence,
  language: observation.language ?? null,
  // FIX-SIGN: the text's corners, for a sign at an angle.
  ...(observation.quad ? { quad: observation.quad } : {}),
});

export function breakdownVision(deps: VisionAnalyserDeps): BreakdownVision {
  const fallback = onceFallbacks(deps.onFallback);
  let installTried = false;

  async function vectors(path: string, frames: readonly number[], signal: AbortSignal) {
    const media = await deps.media();
    if (!media.ok) return media;
    const source = await probeSource(media.value, path, signal);
    if (!source.ok) return source;
    const wanted = unique(frames);
    const found = new Map<number, Float32Array>();
    for (let start = 0; start < wanted.length; start += EMBED_CHUNK) {
      const chunk = wanted.slice(start, start + EMBED_CHUNK);
      let got = await frameVectors(
        chunk,
        source.value,
        { media: media.value, embedder: deps.embedder },
        signal,
      );
      if (
        !got.ok &&
        got.error.code === 'vision.embedder_unavailable' &&
        deps.installEmbedder &&
        !installTried
      ) {
        installTried = true;
        const installed = await deps.installEmbedder(signal);
        if (!installed.ok) return installed;
        got = await frameVectors(
          chunk,
          source.value,
          { media: media.value, embedder: deps.embedder },
          signal,
        );
      }
      if (!got.ok) return got;
      for (const [frame, vector] of got.value) found.set(frame, vector);
    }
    return ok(found);
  }

  return {
    async sceneScores(path, { signal }) {
      const media = await deps.media();
      if (!media.ok) return media;
      fallback('vision.sceneScores', sceneFallback);
      const scored = await sceneScoresOf(path, { media: media.value }, { signal });
      if (!scored.ok) return scored;
      const length = scored.value.samples.reduce((max, sample) => Math.max(max, sample.index + 1), 0);
      const scores = Array.from({ length }, () => 0);
      for (const sample of scored.value.samples) scores[sample.index] = sample.score;
      return ok(scores);
    },

    async frameEmbeddings(path, frames, { signal }) {
      const found = await vectors(path, frames, signal);
      if (!found.ok) return found;
      const out: Float32Array[] = [];
      for (const frame of frames) {
        const vector = found.value.get(Math.max(0, Math.floor(frame)));
        if (!vector) return err(EmbeddingFailed(undefined, { detail: `no vector for frame ${frame}` }));
        out.push(vector);
      }
      return ok(out);
    },

    async ocrFrames(path, { fps, languages, signal }) {
      const media = await deps.media();
      if (!media.ok) return media;
      const pages = await ocrFrames(path, { media: media.value, ocr: deps.ocr }, { fps, languages, signal });
      if (!pages.ok) return pages;
      return ok(pages.value.map((page) => ({ frame: page.frame, lines: page.observations.map(lineOf) })));
    },

    async ocrImage(path, { languages, signal }) {
      const media = await deps.media();
      if (!media.ok) return media;
      const page = await ocrImage(path, { media: media.value, ocr: deps.ocr }, { languages, signal });
      return page.ok ? ok(page.value.observations.map(lineOf)) : page;
    },

    async motionCurve(path, { ranges, signal }) {
      const media = await deps.media();
      if (!media.ok) return media;
      const curve = await motionCurve(
        path,
        { media: media.value },
        { rate: MOTION_RATE, ranges: ranges.map(([start, end]) => ({ start, end })), signal },
      );
      return curve.ok
        ? ok(curve.value.map((sample) => ({ frame: sample.frame, motion: sample.speed })))
        : curve;
    },
  };
}
