// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The HyperFrames producer behind one function (SPEC section 4, "capturing,
 * encoding"). The producer is imported on first use, so a process that never
 * renders never loads Puppeteer, and a broken install is a value, not a crash
 * at start. It is always given a full config (so it reads no PRODUCER_*
 * variables), the pinned shell and Taalcut's own FFmpeg.
 *
 * GPU first (ADR 0002): Chrome rasterises on the GPU (`browserGpuMode:
 * 'hardware'`: Metal on a Mac, ANGLE on Vulkan on Linux, engine patch) and
 * FFmpeg encodes on the hardware encoder media chose (`useGpu`, the family
 * pinned through HYPERFRAMES_GPU_ENCODER: h264_videotoolbox, h264_nvenc). The
 * CPU routes are the caller's to choose, with a reason. Chrome's sandbox stays
 * on where the shell's build says so (Linux, HYPERFRAMES_CHROME_SANDBOX).
 *
 * Every captured frame is the frame's own paint (SPEC section 3,
 * "Determinism"). HyperFrames picks the capture mode: BeginFrame with the
 * headless shell on Linux (HeadlessExperimental.beginFrame: each frame is a
 * fresh paint the capture asks for), drawElement on a Mac
 * with a hardware GPU for a long render (700 frames or more with 24 GB of
 * memory: 3 workers; 900 or more: 1 worker), screenshot otherwise. Screenshot
 * waits for the frame's paint by design. drawElement does through the engine
 * patch (patches/@hyperframes__engine@0.8.209.patch, LRN1-FIX): upstream drew
 * the canvas's last snapshot when a frame's paint was 250 ms late; patched,
 * it waits for the paint, and one that never comes fails the drawElement
 * attempt, which HyperFrames re-renders by screenshot. A render that reports
 * any other capture mode, or that would run under HyperFrames' diagnostic
 * HF_FORCE_DRAWELEMENT (which skips its quality gates), fails rather than
 * ships.
 */
import { CancelledError, err, type FrameRate, ok, type AsyncResult } from '@taalcut/core';
import { CaptureFailed, EncodeFailed, EngineUnavailable } from '../errors';
import { HEADLESS_SHELL } from './headless-shell';
import type * as ProducerModule from '@hyperframes/producer';

type Producer = typeof ProducerModule;

let loaded: Promise<Producer> | undefined;

/** The producer module, loaded once. */
export function loadProducer(): Promise<Producer> {
  loaded ??= import('@hyperframes/producer');
  return loaded;
}

export interface ProducerProgress {
  readonly stage: 'preparing' | 'capturing' | 'encoding' | 'assembling';
  readonly done?: number;
  readonly total?: number;
}

export interface ProducerRunInput {
  /** The written composition bundle. */
  readonly dir: string;
  /** The silent H.264 (or ProRes mezzanine) the producer writes. */
  readonly out: string;
  readonly rate: FrameRate;
  readonly bitrateKbps: number;
  readonly chromePath: string;
  readonly browserGpu: 'hardware' | 'software';
  /** Hardware encode; false renders a ProRes mezzanine (format 'mov') for the CPU route. */
  readonly gpuEncode: boolean;
  /** The hardware H.264 encoder media chose ('h264_nvenc'); absent: HyperFrames detects one itself. */
  readonly gpuEncoder?: string;
  /** Chrome's sandbox on (the shell build's `sandbox`); default off, HyperFrames' own launch. */
  readonly sandbox?: boolean;
  /** Capture workers: a number, or 'auto' (the producer pins 1 on 8 GB machines). */
  readonly workers: number | 'auto';
  readonly binaries: { readonly ffmpeg: string; readonly ffprobe: string };
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ProducerProgress) => void;
  /** Producer log lines worth keeping (warnings and errors). */
  readonly log?: (line: string) => void;
}

export interface ProducerRunResult {
  readonly frames: number;
  readonly workers: number | null;
  readonly captureMode: string | null;
  readonly elapsedMs: number;
  /** What Chrome's GPU probe saw (the WebGL renderer names the GPU that rasterised); null without a probe. */
  readonly browserGpu: BrowserGpuSeen | null;
}

/** The engine's GPU probe answer (patched): the mode, and the WebGL vendor and renderer when it ran. */
export interface BrowserGpuSeen {
  readonly mode: 'hardware' | 'software';
  readonly cause?: string;
  readonly vendor?: string;
  readonly renderer?: string;
}

const STAGES: Readonly<Record<string, ProducerProgress['stage']>> = {
  capture: 'capturing',
  encode: 'encoding',
  assemble: 'assembling',
};

/** Points the producer's FFmpeg lookups at Taalcut's sidecar (engine reads them per call). */
export function useSidecarFfmpeg(binaries: { readonly ffmpeg: string; readonly ffprobe: string }): void {
  process.env.HYPERFRAMES_FFMPEG_PATH = binaries.ffmpeg;
  process.env.HYPERFRAMES_FFPROBE_PATH = binaries.ffprobe;
  process.env.PUPPETEER_SKIP_DOWNLOAD = '1';
}

function quietLogger(log?: (line: string) => void) {
  const keep = (level: string) => (message: string, meta?: Record<string, unknown>) =>
    log?.(`[producer ${level}] ${message}${meta ? ` ${JSON.stringify(meta).slice(0, 2000)}` : ''}`);
  return { error: keep('error'), warn: keep('warn'), info: () => undefined, debug: () => undefined };
}

/**
 * The capture modes an export may run in (see above): HyperFrames' screenshot capture, its patched drawElement, and
 * BeginFrame (Linux headless shell).
 */
export const CAPTURE_MODES: readonly string[] = ['screenshot', 'drawelement', 'beginframe'];

/** HyperFrames' GPU encoder families (engine utils/gpuEncoder.js). */
const GPU_ENCODER_FAMILIES = ['nvenc', 'videotoolbox', 'vaapi', 'qsv', 'amf'] as const;

/** HyperFrames' family for an FFmpeg hardware encoder ('h264_nvenc' → 'nvenc'); undefined for any other. */
export function gpuEncoderFamily(encoder: string): string | undefined {
  const family = encoder.replace(/^(h264|hevc)_/, '');
  return (GPU_ENCODER_FAMILIES as readonly string[]).includes(family) ? family : undefined;
}

/**
 * The engine's variables for one run (it reads them per call): the encoder family media chose, and the sandbox.
 * Undefined unsets a variable, so one run's choice never carries into the next.
 */
export function producerEnvironment(
  input: Pick<ProducerRunInput, 'gpuEncoder' | 'sandbox'>,
): Readonly<Record<string, string | undefined>> {
  const family = input.gpuEncoder === undefined ? undefined : (gpuEncoderFamily(input.gpuEncoder) ?? 'none');
  return {
    HYPERFRAMES_GPU_ENCODER: family,
    HYPERFRAMES_CHROME_SANDBOX: input.sandbox ? '1' : undefined,
  };
}

function applyEnvironment(env: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** One line for the render log: the GPU (or CPU) Chrome rasterised on. */
export function browserGpuLine(seen: BrowserGpuSeen | null, asked: 'hardware' | 'software'): string {
  if (asked === 'software') return '[render] browser raster: software (SwiftShader), as asked';
  if (!seen) return '[render] browser raster: hardware asked, no probe ran';
  const what = [seen.vendor, seen.renderer].filter(Boolean).join(', ') || seen.cause || 'unknown';
  return `[render] browser raster: probe ${seen.mode}: ${what}`;
}

/** What Taalcut sets of the producer's config: the shell, its GPU mode, and the workers when the caller chose a number. */
export function producerOverrides(input: Pick<ProducerRunInput, 'chromePath' | 'browserGpu' | 'workers'>) {
  return {
    chromePath: input.chromePath,
    browserGpuMode: input.browserGpu,
    expectedChromiumMajor: HEADLESS_SHELL.chromiumMajor,
    ...(typeof input.workers === 'number' ? { concurrency: input.workers } : {}),
  } as const;
}

/** Null when every capture session the producer reports ran in one of CAPTURE_MODES, else what it reported. */
export function unexpectedCaptureMode(mode: string | null): string | null {
  if (mode === null) return null;
  return mode.split('|').every((part) => CAPTURE_MODES.includes(part)) ? null : mode;
}

/** Renders the bundle in `dir` to `out`: frames from the pinned shell, encoded by FFmpeg. */
export async function runProducer(input: ProducerRunInput): AsyncResult<ProducerRunResult> {
  if (input.signal?.aborted) return err(CancelledError());
  let producer: Producer;
  try {
    producer = await loadProducer();
  } catch (cause) {
    return err(EngineUnavailable({ reason: 'producer' }, { detail: String(cause) }));
  }
  // HyperFrames' diagnostic drawElement: it skips the engine's quality gates and safety nets, by design.
  if (process.env.HF_FORCE_DRAWELEMENT === '1')
    return err(
      CaptureFailed(undefined, { detail: 'HF_FORCE_DRAWELEMENT is set: a diagnostic capture never ships' }),
    );
  useSidecarFfmpeg(input.binaries);
  applyEnvironment(producerEnvironment(input));
  const started = Date.now();
  const config = producer.resolveConfig(producerOverrides(input));
  const job = producer.createRenderJob({
    fps: { num: input.rate.num, den: input.rate.den },
    quality: 'high',
    format: input.gpuEncode ? 'mp4' : 'mov',
    useGpu: input.gpuEncode,
    hdrMode: 'force-sdr',
    strictness: 'strict',
    ...(input.gpuEncode ? { videoBitrate: `${input.bitrateKbps}k` } : {}),
    ...(typeof input.workers === 'number' ? { workers: input.workers } : {}),
    producerConfig: config,
    logger: quietLogger(input.log),
  });
  let lastKey = '';
  try {
    await producer.executeRenderJob(
      job,
      input.dir,
      input.out,
      (current) => {
        const progress = current.stageProgress;
        const stage = progress ? (STAGES[progress.code] ?? 'preparing') : 'preparing';
        const key = `${stage}:${progress?.done ?? ''}`;
        if (key === lastKey) return;
        lastKey = key;
        input.onProgress?.({
          stage,
          ...(progress?.done !== undefined ? { done: progress.done } : {}),
          ...(progress?.total !== undefined ? { total: progress.total } : {}),
        });
      },
      input.signal,
    );
  } catch (cause) {
    if (input.signal?.aborted || cause instanceof producer.RenderCancelledError) return err(CancelledError());
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    const encodeStage = /encod|ffmpeg|assembl/i.test(job.failedStage ?? '') || /ffmpeg/i.test(detail);
    return err(encodeStage ? EncodeFailed(undefined, { detail }) : CaptureFailed(undefined, { detail }));
  }
  const perf = job.perfSummary;
  const captureMode = perf?.drawElement?.mode ?? null;
  const unexpected = unexpectedCaptureMode(captureMode);
  if (unexpected !== null)
    return err(
      CaptureFailed(undefined, {
        detail: `capture ran in ${unexpected} mode, not ${CAPTURE_MODES.join(', ')}`,
      }),
    );
  const browserGpu = await seenBrowserGpu();
  input.log?.(browserGpuLine(browserGpu, input.browserGpu));
  return ok({
    frames: job.totalFrames ?? perf?.totalFrames ?? 0,
    workers: perf?.workers ?? null,
    captureMode,
    elapsedMs: Date.now() - started,
    browserGpu,
  });
}

/** The engine's GPU probe answer, or null (no probe ran, or an engine without the patch's reader). */
async function seenBrowserGpu(): Promise<BrowserGpuSeen | null> {
  try {
    const probe = (await loadProducerEngine()).browserGpuProbe?.();
    return probe ? await probe : null;
  } catch {
    return null;
  }
}

/** What render reads from the producer's engine (patched: patches/@hyperframes__engine@0.8.209.patch). */
export interface ProducerEngine {
  /** Resolves once every GPU encoder probe started so far has exited; null when none runs (IX3-F5, H3). */
  gpuProbesExited(): Promise<void> | null;
  /**
   * Tells `listener` of every process the engine runs (FFmpeg, ffprobe, the GPU probe, Chrome), synchronously as it
   * starts and as it exits, the ones already running first; returns the unsubscribe (IX3-F7).
   */
  onChildProcess(listener: (pid: number, event: 'spawn' | 'exit') => void): () => void;
  /** What the process's GPU probe saw, or null before any probe started (LNX1-RND). */
  browserGpuProbe?(): Promise<BrowserGpuSeen> | null;
}

let engine: Promise<ProducerEngine> | undefined;

/**
 * The engine the producer runs: its own dependency, resolved from the producer's folder (render depends on the
 * producer only), so it is the same module and sees the producer's probes.
 */
export function loadProducerEngine(): Promise<ProducerEngine> {
  engine ??= (async () => {
    const { createRequire } = await import('node:module');
    const { fileURLToPath, pathToFileURL } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const producer = fileURLToPath(import.meta.resolve('@hyperframes/producer'));
    const enginePackage = createRequire(producer).resolve('@hyperframes/engine/package.json');
    return (await import(
      pathToFileURL(join(dirname(enginePackage), 'dist', 'index.js')).href
    )) as ProducerEngine;
  })();
  return engine;
}

/** The producer's preview runtime (`_hf/runtime.js` of a preview bundle), next to its entry point. */
export async function producerRuntimeScript(): Promise<string> {
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const entry = fileURLToPath(import.meta.resolve('@hyperframes/producer'));
  return join(dirname(entry), 'hyperframe.runtime.iife.js');
}

/** FrameRate as the producer wants it (an exact rational). */
export const toFps = (rate: FrameRate) => ({ num: rate.num, den: rate.den });
