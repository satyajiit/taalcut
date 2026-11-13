// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The conforming stage (SPEC section 4): each clip becomes a segment at the
 * output rate and canvas size, fit applied, upright, SDR, its speed baked in,
 * with its sound as 48 kHz PCM aligned to the first frame. A speed ramp is
 * baked on its exact curve (speed-curve.ts), never its mean. The composition
 * then always plays segments at 1×, and the producer's own frame extraction
 * reads a plain 1080×1920 H.264.
 *
 * GPU first, on media's hardware video table (video-route.ts): the machine's decoder (VideoToolbox on a Mac,
 * NVDEC on an NVIDIA machine) turns and scales on the GPU; only crop or pad, a mirror flip and the tone-map
 * (libplacebo on Vulkan first) run after the download, and a graph with none of them never downloads (NVENC takes
 * the CUDA frames, segment-args.ts). The encoder is media's working H.264 encoder (h264_videotoolbox, h264_nvenc).
 * The software decode is taken when the plan says the hardware can't decode the file, and OpenH264 when the
 * machine has no hardware encoder (or hardware is turned off: `disabled`); a hardware run that fails (the
 * hardware won't start, or can't take the file) runs once more with no hardware at all (software decode,
 * OpenH264), through the shared software retry (hardware-route.ts, IX3-K4). Each is a `compute.fallback` with its
 * reason.
 *
 * Segments are content-addressed in the conform cache, so a resumed export
 * skips clips already done.
 *
 * TODO(media): switch to media's `conform(path, plan, ctx, …)` and the
 * normalisation plan once P2-L4 lands; this private adapter uses only media's
 * Phase 1 public API.
 */
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type ComputeFallbackEvent,
  type FrameRate,
} from '@taalcut/core';
import {
  probeMedia,
  runFfmpeg,
  selectToneMap,
  toneMapFilters,
  type MediaBackend,
  type MediaContext,
  type ProbeResult,
  type VideoStreamInfo,
} from '@taalcut/media';
import { MediaMissing } from '../errors';
import type { PlannedVisual } from '../plan/types';
import { onHardwareRoute } from './hardware-route';
import {
  decodeArgs,
  fitSize,
  placeFilter,
  segmentArgs,
  uprightFilters,
  type SegmentGeometry,
} from './segment-args';
import {
  decodeOn,
  hardwareLabel,
  machineOf,
  planVideoRoute,
  softwareVideoRoute,
  usesHardware,
  wantedBy,
  type RouteDecode,
  type VideoRoute,
} from './video-route';

/**
 * A temporary name of its own for each conform run: two clips with the same segment key conform at once (the
 * same shot used twice, or a preview and an export), and each renames its own finished file into place (the
 * later rename replaces the earlier, identical one) instead of racing for one temporary file.
 */
const partFile = (file: string, ext: string) => `${file}.${randomUUID().slice(0, 8)}.part.${ext}`;

export { fitSize, TAIL_FRAMES } from './segment-args';

/**
 * Bump when the segment recipe changes, so old cache entries stop matching.
 * 3: upright once (no display matrix left on the segment, mirrored matrices flipped).
 * 4: speed ramps baked on their exact curve, transition lead-ins at real time.
 * 5: stills take the VideoToolbox route first and record the route they took.
 * 6: the machine's encoder with media's conform flags (LNX1-RND), no no-op crop or pad.
 */
export const CONFORM_RECIPE = 6;

export interface ConformSource {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface ConformedSegment {
  /** The segment (mp4) or still (jpg). */
  readonly file: string;
  /** 48 kHz stereo PCM aligned to the segment's first frame, or null when the clip has no sound. */
  readonly audio: string | null;
  /** Content key: names the files and goes into the composition hash. */
  readonly key: string;
  /** Frames the clip shows (the file holds TAIL_FRAMES more). */
  readonly frames: number;
  /** Time inside the file at the visual's visible.start: always its start. */
  readonly mediaStart: RationalTime;
  readonly ext: 'mp4' | 'jpg';
  /** The hw-video row that decoded it ('videotoolbox', 'cuda'), or 'software' (with the reason in `fallback`). */
  readonly decode: MediaBackend;
  readonly fallback?: string;
}

export interface ConformOptions {
  readonly dir: string;
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  /** P3-V2: a reframed video's scale and extent crop (absent: its fit on the canvas). */
  readonly geometry?: SegmentGeometry;
  readonly ctx: MediaContext;
  readonly signal?: AbortSignal;
  /** A CPU route was taken: one compute.fallback with its operation and reason. */
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** The route each segment ran on, for the render log. */
  readonly log?: (line: string) => void;
}

/** The content key of a segment: everything that changes its bytes. */
export function conformKey(
  visual: PlannedVisual,
  source: ConformSource,
  options: Pick<ConformOptions, 'rate' | 'width' | 'height' | 'geometry'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        recipe: CONFORM_RECIPE,
        source: [source.path, source.size, Math.round(source.mtimeMs)],
        kind: visual.kind,
        sourceIn: [visual.sourceIn.value, visual.sourceIn.rate.num, visual.sourceIn.rate.den],
        frames: visual.visible.end - visual.visible.start,
        // The whole curve: two ramps with one mean are different segments.
        speed: visual.speed,
        holdFrame: visual.holdFrame,
        lead: visual.cut.start - visual.visible.start,
        fit: visual.fit,
        rate: [options.rate.num, options.rate.den],
        size: [options.width, options.height],
        // A reframed segment is a different file; Phase 2 keys stay as they were.
        ...(options.geometry ? { geometry: options.geometry } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 40);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** A still's one frame on a decode route: a hardware route rotates and scales on its device like a clip. */
function stillArgs(
  visual: PlannedVisual,
  path: string,
  video: VideoStreamInfo | undefined,
  decode: RouteDecode,
  out: string,
  options: ConformOptions,
): string[] {
  const display = video ? { width: video.displayWidth, height: video.displayHeight } : options;
  const size = fitSize(display, options, visual.fit);
  const place = `${placeFilter(visual.fit, options.width, options.height)},setsar=1`;
  // The software route keeps FFmpeg's autorotate, which applies EXIF orientation the probe may not see.
  const hardware = decode.backend !== 'software' && video !== undefined;
  const filters = hardware
    ? `${uprightFilters(video, decode, size).join(',')},${place}`
    : `scale=${size.width}:${size.height},${place}`;
  return [
    '-y',
    ...(hardware ? decodeArgs(decode) : []),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    filters,
    '-q:v',
    '2',
    out,
  ];
}

/**
 * A still, GPU first (ADR 0002): the machine's decoder when the plan says it decodes the still (VideoToolbox does,
 * HEIC is HEVC; NVDEC takes no stills, media's row), else the CPU scale with `compute.fallback` naming why, as clips
 * do. A failed hardware run is retried in software and reported as `accelerator_failed`.
 */
async function conformStill(
  visual: PlannedVisual,
  source: ConformSource,
  key: string,
  options: ConformOptions,
): AsyncResult<ConformedSegment> {
  const file = join(options.dir, `${key}.jpg`);
  const meta = join(options.dir, `${key}.json`);
  const base = {
    file,
    audio: null,
    key,
    frames: 1,
    mediaStart: RationalTime.zero(options.rate),
    ext: 'jpg' as const,
  };
  const cached = await readFile(meta, 'utf8').then(
    (text) => JSON.parse(text) as Pick<ConformedSegment, 'decode' | 'fallback'>,
    () => null,
  );
  if (cached && (await exists(file))) return ok({ ...base, ...cached });
  const probe = await probeMedia(source.path, options.ctx);
  if (!probe.ok) return probe;
  const video = probe.value.video;
  const machine = await machineOf(options.ctx, options.signal);
  if (!machine.ok) return machine;
  const planned = decodeOn(options.ctx, machine.value, video, 'render.conformStill', { still: true });
  const temp = partFile(file, 'jpg');
  const first = planned.decode;
  let fallback = planned.fallback?.detail;
  if (planned.fallback) options.onFallback?.(planned.fallback);
  let decode: MediaBackend = first.backend;
  const run = await onHardwareRoute<RouteDecode, unknown>(
    {
      first,
      software: first.backend !== 'software' ? { backend: 'software' } : undefined,
      operation: 'render.conformStill',
      wanted: wantedBy({ decode: first, encoder: softwareVideoRoute(options.ctx.platform).encoder }),
      label: hardwareLabel({ decode: first, encoder: softwareVideoRoute(options.ctx.platform).encoder }),
      anyFfmpegFailure: true,
      ...(options.signal ? { signal: options.signal } : {}),
      onFallback: (event) => {
        fallback = event.detail ?? '';
        options.onFallback?.(event);
      },
    },
    (route) => {
      decode = route.backend;
      return runFfmpeg(options.ctx, stillArgs(visual, source.path, video, route, temp, options), {
        // A hardware decode is never killed on a stop (IX3-K2).
        holdsVideoSession: route.backend !== 'software',
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs: 120_000,
      });
    },
  );
  if (!run.ok) {
    await rm(temp, { force: true });
    return run;
  }
  await rename(temp, file);
  const result = { decode, ...(fallback ? { fallback } : {}) };
  await writeFile(meta, JSON.stringify(result));
  return ok({ ...base, ...result });
}

interface SegmentJob {
  readonly visual: PlannedVisual;
  readonly path: string;
  readonly video: VideoStreamInfo;
  readonly toneMap: readonly string[];
  readonly hasAudio: boolean;
  readonly temp: { readonly video: string; readonly audio: string };
}

/**
 * A clip's segment, GPU first: the machine's decoder (when the plan allows) and encoder; when the hardware fails,
 * once more with no hardware at all (software decode, OpenH264), reported as `accelerator_failed` (IX3-K4).
 */
async function encodeSegment(
  job: SegmentJob,
  options: ConformOptions,
): AsyncResult<Pick<ConformedSegment, 'decode' | 'fallback'>> {
  const planned = await planVideoRoute(options.ctx, {
    video: job.video,
    codec: 'h264',
    size: options,
    operation: 'render.conform',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!planned.ok) return planned;
  const first = planned.value.route;
  for (const event of planned.value.fallbacks) options.onFallback?.(event);
  let fallback = planned.value.fallbacks.find((event) => event.operation === 'render.conformDecode')?.detail;
  let decode: MediaBackend = first.decode.backend;
  let encoder = first.encoder;
  const run = await onHardwareRoute<VideoRoute, unknown>(
    {
      first,
      // A route with no hardware at all has nothing to retry without.
      software: usesHardware(first) ? softwareVideoRoute(options.ctx.platform) : undefined,
      operation: 'render.conformDecode',
      wanted: wantedBy(first),
      label: hardwareLabel(first),
      // Any failure of a hardware decode, as before (a file it can't take); on a planned software decode only a refusal.
      anyFfmpegFailure: first.decode.backend !== 'software',
      ...(options.signal ? { signal: options.signal } : {}),
      onFallback: (event) => {
        fallback = event.detail ?? '';
        options.onFallback?.(event);
      },
    },
    (route) => {
      decode = route.decode.backend;
      encoder = route.encoder;
      const { visual, path, video, toneMap, hasAudio, temp } = job;
      return runFfmpeg(
        options.ctx,
        ['-y', ...segmentArgs(visual, path, video, route, toneMap, hasAudio, temp, options)],
        {
          // A hardware decode or encode is never killed on a stop (IX3-K2).
          holdsVideoSession: usesHardware(route),
          ...(options.signal ? { signal: options.signal } : {}),
          timeoutMs: 15 * 60_000,
        },
      );
    },
  );
  if (!run.ok) return run;
  options.log?.(`[render] conform ${job.visual.id}: decode ${decode}, encode ${encoder}`);
  return ok({ decode, ...(fallback ? { fallback } : {}) });
}

/** Conforms one visual (video or still), reusing the cache when the key matches. */
export async function conformVisual(
  visual: PlannedVisual,
  source: ConformSource,
  options: ConformOptions,
): AsyncResult<ConformedSegment> {
  await mkdir(options.dir, { recursive: true });
  const key = conformKey(visual, source, options);
  if (visual.kind === 'image') return conformStill(visual, source, key, options);
  const meta = join(options.dir, `${key}.json`);
  const file = join(options.dir, `${key}.mp4`);
  const wav = join(options.dir, `${key}.wav`);
  const frames = visual.visible.end - visual.visible.start;
  const base = { file, key, frames, mediaStart: RationalTime.zero(options.rate), ext: 'mp4' as const };
  const cached = await readFile(meta, 'utf8').then(
    (text) => JSON.parse(text) as Pick<ConformedSegment, 'decode' | 'fallback'> & { audio: boolean },
    () => null,
  );
  if (cached && (await exists(file))) {
    const now = new Date();
    await utimes(file, now, now).catch(() => undefined);
    return ok({
      ...base,
      audio: cached.audio ? wav : null,
      decode: cached.decode,
      ...(cached.fallback ? { fallback: cached.fallback } : {}),
    });
  }
  const probe: Awaited<AsyncResult<ProbeResult>> = await probeMedia(source.path, options.ctx);
  if (!probe.ok) return probe;
  const video = probe.value.video;
  if (!video) return err(MediaMissing({ name: visual.id }, { detail: 'no video stream' }));
  const hasAudio = probe.value.audio !== undefined;
  let toneMap: string[] = [];
  if (video.isHdr) {
    const choice = await selectToneMap(options.ctx, options.signal ? { signal: options.signal } : {});
    if (!choice.ok) return choice;
    toneMap = toneMapFilters(choice.value, video);
    if (choice.value.backend === 'software')
      options.onFallback?.({
        operation: 'render.toneMap',
        wanted: ['vulkan'],
        reason: 'unsupported_input',
        detail: (choice.value.fallbackReason?.detail ?? 'no Vulkan').slice(0, 2000),
      });
  }
  const temp = { video: partFile(file, 'mp4'), audio: partFile(wav, 'wav') };
  const run = await encodeSegment({ visual, path: source.path, video, toneMap, hasAudio, temp }, options);
  if (!run.ok) {
    await rm(temp.video, { force: true });
    await rm(temp.audio, { force: true });
    return run;
  }
  await rename(temp.video, file);
  if (hasAudio) await rename(temp.audio, wav);
  await writeFile(meta, JSON.stringify({ ...run.value, audio: hasAudio }));
  return ok({ ...base, audio: hasAudio ? wav : null, ...run.value });
}
