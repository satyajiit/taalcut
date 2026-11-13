// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one video decode QA makes (docs/qa-gate.md, "One video pass"):
 * the machine's hardware decoder and its scale to 270×480 on the GPU
 * (VideoToolbox and scale_vt on a Mac, NVDEC and scale_cuda on NVIDIA:
 * media's hw-video rows), then the CPU filters FFmpeg has no GPU version of
 * (blackdetect, freezedetect, scdet, bbox), their per-frame metadata printed
 * to a file. Software decode only when the machine has no hardware decoder,
 * or it can't take the file or won't start (the shared software retry,
 * engine/hardware-route.ts, IX3-K4), reported as compute.fallback.
 *
 * bbox stands in for cropdetect: cropdetect is GPL-only and the LGPL sidecar
 * doesn't have it.
 *
 * TODO(media): swap for media's analyseVideo once P2-L4/L5 land; the parse below stays.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type ComputeFallbackEvent, type FrameRate } from '@taalcut/core';
import {
  FfmpegFailed,
  hwDownloadFilters,
  hwScaleFilter,
  hwVideoBackend,
  machineVideoBackends,
  runFfmpeg,
  turnsOnDevice,
  type HardwareBackend,
  type MediaContext,
} from '@taalcut/media';
import { onHardwareRoute } from '../../engine/hardware-route';
import { fallbackEvent, wantedFor } from '../../engine/video-route';
import type { FrameSpan } from '../../plan/types';
import { QA_THRESHOLDS } from '../thresholds.v1';

export interface VideoPass {
  readonly frames: number;
  readonly black: readonly FrameSpan[];
  readonly freezes: readonly FrameSpan[];
  /** scdet score of frame k against frame k − 1. */
  readonly sceneScores: readonly number[];
  /** bbox of non-dark pixels per frame on the analysis size; null when the frame is all dark. */
  readonly boxes: readonly ({ readonly width: number; readonly height: number } | null)[];
  readonly analysisSize: { readonly width: number; readonly height: number };
  /** The hw-video row that decoded it ('videotoolbox', 'cuda'), or 'cpu'. */
  readonly backend: HardwareBackend | 'cpu';
}

export interface VideoPassOptions {
  readonly rate: FrameRate;
  readonly signal?: AbortSignal;
  /** 'software' skips the hardware decoder (tests, diagnostics). Default 'auto': GPU first. */
  readonly decode?: 'auto' | 'software';
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** freezedetect's noise tolerance. Default the render's (QA_THRESHOLDS.frozen.noiseDb). */
  readonly freezeNoiseDb?: number;
  /** freezedetect's shortest freeze, seconds. Default the render's (QA_THRESHOLDS.frozen.minSeconds). */
  readonly freezeMinSeconds?: number;
  /**
   * Only `frames` frames of the file from frame `start` (a constant `rate` file, such as a conform segment). The
   * pass then counts frames from `start`, and freezedetect's first reference is that frame.
   */
  readonly range?: { readonly start: number; readonly frames: number };
  /**
   * CPU filters that make each decoded frame the picture the render shows of it (a reframed clip's crop window),
   * run on the full frame before the analysis scale.
   */
  readonly view?: readonly string[];
}

/** What the FFmpeg run asks of the file, with the defaults filled in. */
interface PassShape {
  readonly rate: FrameRate;
  readonly freezeNoiseDb: number;
  readonly freezeMinSeconds: number;
  readonly range?: { readonly start: number; readonly frames: number };
  readonly view: readonly string[];
}

const OPERATION = 'render.qaVideoDecode';

const toFrame = (seconds: number, rate: FrameRate) => Math.round((seconds * rate.num) / rate.den);

/** Parses `metadata=mode=print:file=` output into the pass. Pure. */
export function parseVideoMetadata(
  text: string,
  rate: FrameRate,
): Omit<VideoPass, 'backend' | 'analysisSize'> {
  const scores: number[] = [];
  const boxes: ({ width: number; height: number } | null)[] = [];
  const black: FrameSpan[] = [];
  const freezes: FrameSpan[] = [];
  let frame = -1;
  let box: { width?: number; height?: number } = {};
  let blackStart: number | undefined;
  let freezeStart: number | undefined;
  const closeFrame = () => {
    if (frame < 0) return;
    boxes[frame] =
      box.width !== undefined && box.height !== undefined ? { width: box.width, height: box.height } : null;
    scores[frame] ??= 0;
  };
  for (const line of text.split('\n')) {
    const header = /^frame:(\d+)\s/.exec(line);
    if (header) {
      closeFrame();
      frame = Number(header[1]);
      box = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || frame < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = Number(line.slice(eq + 1));
    if (!Number.isFinite(value)) continue;
    if (key === 'lavfi.scd.score') scores[frame] = value;
    else if (key === 'lavfi.bbox.w') box.width = value;
    else if (key === 'lavfi.bbox.h') box.height = value;
    else if (key === 'lavfi.black_start') blackStart = toFrame(value, rate);
    else if (key === 'lavfi.black_end') {
      black.push({ start: blackStart ?? 0, end: toFrame(value, rate) });
      blackStart = undefined;
    } else if (key === 'lavfi.freezedetect.freeze_start') freezeStart = toFrame(value, rate);
    else if (key === 'lavfi.freezedetect.freeze_end') {
      freezes.push({ start: freezeStart ?? 0, end: toFrame(value, rate) });
      freezeStart = undefined;
    }
  }
  closeFrame();
  const frames = frame + 1;
  // An interval still open at the end of the file runs to its last frame.
  if (blackStart !== undefined) black.push({ start: blackStart, end: frames });
  if (freezeStart !== undefined) freezes.push({ start: freezeStart, end: frames });
  for (let index = 0; index < frames; index++) {
    scores[index] ??= 0;
    if (boxes[index] === undefined) boxes[index] = null;
  }
  return { frames, black, freezes, sceneScores: scores, boxes };
}

/** Quotes a path for a filtergraph option value. */
function filterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function filters(metadataFile: string, shape: PassShape): string {
  const { black, sceneChange, blackBars } = QA_THRESHOLDS;
  return [
    `blackdetect=d=${black.minSeconds}:pic_th=${black.pictureRatio}:pix_th=${black.pixelLuma}`,
    `freezedetect=n=${shape.freezeNoiseDb}dB:d=${Number(shape.freezeMinSeconds.toFixed(6))}`,
    `scdet=threshold=${sceneChange.threshold}`,
    `bbox=min_val=${blackBars.minLuma}`,
    `metadata=mode=print:file=${filterPath(metadataFile)}`,
  ].join(',');
}

/** FFmpeg's arguments for the pass. */
function passArgs(
  path: string,
  metadataFile: string,
  hardware: HardwareBackend | undefined,
  shape: PassShape,
): string[] {
  const { width, height } = QA_THRESHOLDS.analysisSize;
  const { range, rate, view } = shape;
  // An accurate input seek a quarter frame before `start` keeps exactly the frames from `start` on; frame n of the
  // range is then retimed to n / rate, so the pass's frames (and freezes) count from it. `trim` ends the range at
  // its last frame inside the graph (the output's frame limit alone lets one more frame through the filters), and
  // the limit stops the decode there.
  const seek =
    range && range.start > 0 ? ['-ss', (((range.start - 0.25) * rate.den) / rate.num).toFixed(6)] : [];
  const take = range ? ['-frames:v', String(range.frames)] : [];
  const retime = range ? [`setpts=N*${rate.den}/${rate.num}/TB`, `trim=end_frame=${range.frames}`] : [];
  const analysis = filters(metadataFile, shape);
  const tail = ['-an', '-f', 'null', '-'];
  if (hardware) {
    const decode = hwVideoBackend(hardware).decode!;
    const download = hwDownloadFilters(hardware, 'nv12', false);
    const scale = turnsOnDevice(hardware) ? hwScaleFilter(hardware, width, height) : undefined;
    // A view crops the full frame, so the frame comes down from the GPU first; without one the GPU scales.
    const chain =
      view.length > 0 || !scale
        ? [...download, ...retime, ...view, `scale=${width}:${height}`, 'format=nv12', analysis]
        : [scale, ...download, ...retime, analysis];
    return [
      '-hwaccel',
      decode.hwaccel,
      '-hwaccel_output_format',
      decode.outputFormat,
      ...seek,
      '-i',
      path,
      '-vf',
      chain.join(','),
      ...take,
      ...tail,
    ];
  }
  const chain = [...retime, ...view, `scale=${width}:${height}`, 'format=nv12', analysis];
  return [...seek, '-i', path, '-vf', chain.join(','), ...take, ...tail];
}

/** The machine's first row that decodes, or why the pass decodes in software. */
async function firstDecoder(
  ctx: MediaContext,
  options: VideoPassOptions,
): AsyncResult<{ readonly row?: HardwareBackend; readonly fallback?: ComputeFallbackEvent }> {
  const wanted = wantedFor(ctx, 'decode');
  if (options.decode === 'software')
    return ok({
      fallback: fallbackEvent(OPERATION, wanted, { code: 'requested', detail: 'software decode asked for' }),
    });
  const machine = await machineVideoBackends(ctx, options.signal);
  if (!machine.ok) return machine;
  const row = machine.value.backends.find((id) => hwVideoBackend(id).decode !== undefined);
  if (row) return ok({ row });
  const why = machine.value.disabled
    ? ({ code: 'requested', detail: machine.value.disabled } as const)
    : ({
        code: 'no_hardware_backend',
        detail: machine.value.missing ?? 'no hardware video decoder on this machine',
      } as const);
  return ok({ fallback: fallbackEvent(OPERATION, wanted, why) });
}

/** Runs the pass, the machine's hardware decoder first. */
export async function runVideoPass(
  ctx: MediaContext,
  path: string,
  options: VideoPassOptions,
): AsyncResult<VideoPass> {
  const decoder = await firstDecoder(ctx, options);
  if (!decoder.ok) return decoder;
  if (decoder.value.fallback) options.onFallback?.(decoder.value.fallback);
  const first = decoder.value.row;
  const shape: PassShape = {
    rate: options.rate,
    freezeNoiseDb: options.freezeNoiseDb ?? QA_THRESHOLDS.frozen.noiseDb,
    freezeMinSeconds: options.freezeMinSeconds ?? QA_THRESHOLDS.frozen.minSeconds,
    view: options.view ?? [],
    ...(options.range ? { range: options.range } : {}),
  };
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-qa-'));
  const metadataFile = join(dir, 'qa-video.txt');
  try {
    let decodedOn = first;
    const result = await onHardwareRoute<{ readonly row?: HardwareBackend }, unknown>(
      {
        first: first ? { row: first } : {},
        software: first ? {} : undefined,
        operation: OPERATION,
        wanted: first ? [hwVideoBackend(first).compute.decode] : [],
        label: first ? (hwVideoBackend(first).decode?.label ?? first) : 'software',
        // The hardware couldn't take this file (codec, corrupt stream) or start: decode it once more in software.
        anyFfmpegFailure: true,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onFallback ? { onFallback: options.onFallback } : {}),
      },
      ({ row }) => {
        decodedOn = row;
        return runFfmpeg(ctx, passArgs(path, metadataFile, row, shape), {
          // A hardware decode is never killed on a stop (IX3-K2).
          holdsVideoSession: row !== undefined,
          timeoutMs: 600_000,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      },
    );
    if (!result.ok) return result;
    const text = await readFile(metadataFile, 'utf8');
    return ok({
      ...parseVideoMetadata(text, options.rate),
      analysisSize: QA_THRESHOLDS.analysisSize,
      backend: decodedOn ?? 'cpu',
    });
  } catch (cause) {
    return err(FfmpegFailed({ exitCode: -1 }, { detail: `QA video pass: ${String(cause)}` }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
