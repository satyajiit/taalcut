// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The picture half of an export: conform every visual, compile the
 * 'export' composition over the segments, write it, and have the producer
 * capture and encode it to a silent video. The export pipeline adds sound,
 * finishing and QA around this; tests drive it directly for frame oracles.
 */
import { join } from 'node:path';
import {
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type ExportPreset,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { compileComposition, type CompileOptions, type CompositionBundle } from '../compile/composition';
import { MediaMissing } from '../errors';
import { planTimeline } from '../plan/render-plan';
import type { PlannedVisual } from '../plan/types';
import { videoBitrateKbps } from '../presets/presets.v1';
import { writeBundle } from './bundle-writer';
import { conformVisual, type ConformedSegment, type ConformOptions, type ConformSource } from './conform';
import { withProducerSessions } from './hardware-sessions';
import { HEADLESS_SHELL } from './headless-shell';
import { runProducer, type BrowserGpuSeen, type ProducerProgress } from './producer';

export interface RenderVideoInput {
  readonly timeline: Timeline;
  readonly preset: ExportPreset;
  readonly burnCaptions: boolean;
  /** The original of each asset (preflight has checked it). */
  readonly source: (visual: PlannedVisual) => ConformSource | undefined;
  readonly ctx: MediaContext;
  readonly conformDir: string;
  /** This render's work folder: the bundle goes in `bundle/`, the video next to it. */
  readonly workDir: string;
  readonly chromePath: string;
  readonly browserGpu: 'hardware' | 'software';
  readonly gpuEncode: boolean;
  /** The hardware H.264 encoder media chose for the producer ('h264_nvenc'); absent: HyperFrames detects one. */
  readonly gpuEncoder?: string;
  readonly workers: number | 'auto';
  readonly fonts?: CompileOptions['fonts'];
  readonly captionLayout?: CompileOptions['captionLayout'];
  readonly signal?: AbortSignal;
  /** Conform progress: clips done of total. */
  readonly onConform?: (done: number, total: number) => void;
  readonly onCapture?: (progress: ProducerProgress) => void;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly log?: (line: string) => void;
  /** Clips conformed at once (the hardware runs several sessions). */
  readonly conformConcurrency?: number;
  /** P3-V2, P3-V10: what the composition draws besides the timeline (framing, the Style, dodged captions). */
  readonly compose?: Pick<
    CompileOptions,
    'framing' | 'cropStyle' | 'captionAnchors' | 'style' | 'brandAssets' | 'bumpers' | 'keepOut' | 'workspace'
  >;
  /** P3-V2: the conform geometry of a reframed visual (absent: the visual's fit on the canvas). */
  readonly geometry?: (visual: PlannedVisual) => ConformOptions['geometry'];
  /** P3-V17: runs on each conformed segment before the composition reads it (the grade). */
  readonly afterConform?: (visual: PlannedVisual, segment: ConformedSegment) => AsyncResult<ConformedSegment>;
}

export interface RenderedVideo {
  readonly bundle: CompositionBundle;
  readonly bundleDir: string;
  readonly segments: ReadonlyMap<string, ConformedSegment>;
  /** Silent H.264 from the producer (or a ProRes mezzanine on the CPU route). */
  readonly video: string;
  readonly frames: number;
  readonly timings: { readonly conformMs: number; readonly captureMs: number };
  readonly producer: {
    readonly workers: number | null;
    readonly captureMode: string | null;
    /** What Chrome's GPU probe saw: the renderer names the GPU that rasterised. */
    readonly browserGpu: BrowserGpuSeen | null;
  };
}

/** One visual's segment: conformed (with its reframe geometry), then the grade when there is one. */
async function conformOne(input: RenderVideoInput, visual: PlannedVisual): AsyncResult<ConformedSegment> {
  const source = input.source(visual);
  if (!source) return err(MediaMissing({ name: visual.id }));
  const geometry = input.geometry?.(visual);
  const conformed = await conformVisual(visual, source, {
    dir: input.conformDir,
    rate: input.timeline.canvas.rate,
    width: input.preset.width,
    height: input.preset.height,
    ctx: input.ctx,
    ...(geometry ? { geometry } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onFallback ? { onFallback: input.onFallback } : {}),
    ...(input.log ? { log: input.log } : {}),
  });
  return conformed.ok && input.afterConform ? input.afterConform(visual, conformed.value) : conformed;
}

async function conformAll(
  input: RenderVideoInput,
  visuals: readonly PlannedVisual[],
): AsyncResult<Map<string, ConformedSegment>> {
  const segments = new Map<string, ConformedSegment>();
  const queue = visuals.filter((visual) => visual.enabled);
  let next = 0;
  let failure: Awaited<AsyncResult<ConformedSegment>> | undefined;
  const worker = async () => {
    while (next < queue.length && !failure) {
      const visual = queue[next++]!;
      const finished = await conformOne(input, visual);
      if (!finished.ok) {
        failure = finished;
        return;
      }
      segments.set(visual.id, finished.value);
      input.onConform?.(segments.size, queue.length);
    }
  };
  const concurrency = Math.max(1, Math.min(input.conformConcurrency ?? 3, queue.length));
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failure && !failure.ok) return failure;
  return ok(segments);
}

export async function renderVideo(input: RenderVideoInput): AsyncResult<RenderedVideo> {
  const planned = planTimeline(input.timeline);
  if (!planned.ok) return planned;
  const conformStarted = Date.now();
  const segments = await conformAll(input, planned.value.visuals);
  if (!segments.ok) return segments;
  const conformMs = Date.now() - conformStarted;
  const compiled = compileComposition(input.timeline, {
    variant: 'export',
    preset: input.preset,
    burnCaptions: input.burnCaptions,
    media: (visual) => {
      const segment = segments.value.get(visual.id);
      return segment
        ? { file: segment.file, key: segment.key, mediaStart: segment.mediaStart, ext: segment.ext }
        : undefined;
    },
    ...(input.fonts ? { fonts: input.fonts } : {}),
    ...(input.captionLayout ? { captionLayout: input.captionLayout } : {}),
    ...input.compose,
  });
  if (!compiled.ok) return compiled;
  const bundleDir = join(input.workDir, 'bundle');
  await writeBundle(compiled.value, bundleDir);
  const video = join(input.workDir, input.gpuEncode ? 'video.mp4' : 'video.mov');
  const captureStarted = Date.now();
  // The producer spawns its own FFmpeg and Chrome, outside ctx.runner's hardware session cap.
  const rendered = await withProducerSessions(input.ctx, input, input.signal, () =>
    runProducer({
      dir: bundleDir,
      out: video,
      rate: input.timeline.canvas.rate,
      bitrateKbps: videoBitrateKbps(input.preset, input.timeline.canvas.rate),
      chromePath: input.chromePath,
      browserGpu: input.browserGpu,
      gpuEncode: input.gpuEncode,
      ...(input.gpuEncoder ? { gpuEncoder: input.gpuEncoder } : {}),
      sandbox: HEADLESS_SHELL.sandbox,
      workers: input.workers,
      binaries: input.ctx.binaries,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onCapture ? { onProgress: input.onCapture } : {}),
      ...(input.log ? { log: input.log } : {}),
    }),
  );
  if (!rendered.ok) return rendered;
  return ok({
    bundle: compiled.value,
    bundleDir,
    segments: segments.value,
    video,
    frames: rendered.value.frames,
    timings: { conformMs, captureMs: Date.now() - captureStarted },
    producer: {
      workers: rendered.value.workers,
      captureMode: rendered.value.captureMode,
      browserGpu: rendered.value.browserGpu,
    },
  });
}
