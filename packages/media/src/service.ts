// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MediaService: the media functions bound to a binary resolver, for
 * registration in the DI container. The plain functions stay available for
 * callers that already hold resolved binaries (tools, jobs, tests).
 */
import type { AsyncResult, ComputeFallbackEvent } from '@taalcut/core';
import {
  HardwareFailures,
  reportFallback,
  type BackendFallback,
  type BackendFallbackListener,
  type EncodeCodec,
  type EncoderChoice,
} from './backends';
import type { DerivedCache } from './cache/cache';
import type { DecodeProfileSource } from './decode-routes/select-route';
import type { BinaryResolver, ResolvedFfmpeg } from './binaries/resolver';
import {
  detectEncoders,
  EncoderSelection,
  selectWorkingEncoder,
  type EncoderSupport,
  type WorkingEncoderOptions,
} from './encoders';
import { runFfmpeg, type FfmpegRunOptions, type MediaContext } from './ffmpeg';
import type { HardwareSessionGate } from './hardware-sessions/types';
import { hardwareSessionContext } from './hardware-sessions/runner';
import { VideoBackendSelection, type NamedVideoBackends } from './hw-video/machine';
import { extractFrame, type ExtractedFrame, type ExtractFrameOptions } from './frames/extract-frame';
import {
  conformAsset,
  enforceCache,
  normaliseAsset,
  previewsAsset,
  proxyAsset,
  type RunOptions,
} from './jobs/operate';
import { filmstripAsset } from './jobs/filmstrip-asset';
import { thumbnailAsset } from './jobs/thumbnail-asset';
import type {
  ConformJobInput,
  ConformJobOutput,
  EnforceCacheCapJobInput,
  EnforceCacheCapJobOutput,
  MakeFilmstripJobInput,
  MakeFilmstripJobOutput,
  MakePreviewsJobInput,
  MakePreviewsJobOutput,
  MakeProxyJobInput,
  MakeThumbnailJobInput,
  MakeThumbnailJobOutput,
  NormaliseJobInput,
  NormaliseJobOutput,
  ProxyJobOutput,
} from './jobs/phase2-kinds';
import type { SpeechPcmPort } from './previews/speech-pcm-port';
import type { StillMetadataReader } from './sidecar/still';
import { probeMedia, type ProbeOptions } from './probe/probe';
import type { ProbeResult } from './probe/types';
import type { ProcessOutput, ProcessRunner } from './process/runner';
import type { RationalTime } from './rational-time';
import { ToneMapSelection, type ToneMapChoice, type ToneMapOptions } from './tonemap';

export interface MediaService {
  /** Which binaries are in use, their versions and licences (Settings → About). */
  binaries(): AsyncResult<ResolvedFfmpeg>;
  probe(path: string, options?: ProbeOptions): AsyncResult<ProbeResult>;
  extractFrame(path: string, at: RationalTime, options?: ExtractFrameOptions): AsyncResult<ExtractedFrame>;
  detectEncoders(options?: { signal?: AbortSignal; timeoutMs?: number }): AsyncResult<EncoderSupport>;
  /** The encoder to use for `codec`: hardware first, proven by a trial encode (ADR 0002). */
  selectEncoder(codec: EncodeCodec, options?: WorkingEncoderOptions): AsyncResult<EncoderChoice>;
  /** The HDR tone-map: libplacebo on Vulkan when a trial frame passes, else CPU zscale. Proven once. */
  selectToneMap(options?: ToneMapOptions): AsyncResult<ToneMapChoice>;
  runFfmpeg(args: readonly string[], options?: FfmpegRunOptions): AsyncResult<ProcessOutput>;
  /** Software fallbacks so far, by 'decode:<code>' / 'encode:<code>', for the trace and Settings. */
  fallbackCounts(): Readonly<Record<string, number>>;
  /** Plan plus facts. Writes an upright still only when the plan asks for one. */
  normalise(input: NormaliseJobInput & RunOptions): AsyncResult<NormaliseJobOutput>;
  /** Short-GOP proxy, stored in the cache unless the original is reused. */
  makeProxy(input: MakeProxyJobInput & RunOptions): AsyncResult<ProxyJobOutput>;
  /** The waveform. Reads the proxy when `proxyKey` resolves in the cache. */
  makePreviews(input: MakePreviewsJobInput & RunOptions): AsyncResult<MakePreviewsJobOutput>;
  /** The filmstrip sprite and its frames' times (UX2), from the proxy when `proxyKey` resolves in the cache. */
  makeFilmstrip(input: MakeFilmstripJobInput & RunOptions): AsyncResult<MakeFilmstripJobOutput>;
  /** The poster frame (IX-D4), from five keyframes (IX2-T2) or, for a clip with few, five exact frames. */
  makeThumbnail(
    input: MakeThumbnailJobInput & RunOptions,
  ): AsyncResult<Omit<MakeThumbnailJobOutput, 'decodes'>>;
  /** Full-quality conformed file for a range, stored in the cache. */
  conform(input: ConformJobInput & RunOptions): AsyncResult<ConformJobOutput>;
  /** Evict oldest derived files down to 90% of `capBytes`. */
  enforceCacheCap(input: EnforceCacheCapJobInput): AsyncResult<EnforceCacheCapJobOutput>;
}

export interface MediaServiceDeps {
  readonly resolver: BinaryResolver;
  readonly runner?: ProcessRunner;
  /** Every software fallback, after it is counted. Without one they are logged with console.warn. */
  readonly onBackendFallback?: BackendFallbackListener;
  /** core `compute.fallback` payloads. CPU choices in Phase 2 emit one. */
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
  /** Derived-file cache. Store jobs return media.cache_unavailable when it is absent. */
  readonly cache?: DerivedCache;
  /** Still metadata. Images without one use the probe reader inside the call. */
  readonly stillReader?: StillMetadataReader;
  /** The app-wide hardware session cap: every FFmpeg call that opens a hardware session waits for a slot. */
  readonly hardwareSessions?: HardwareSessionGate;
  /** Waveform peaks from the audio pass (audio's asset audio store), instead of decoding the audio again. */
  readonly speechPcm?: SpeechPcmPort;
  /**
   * The hardware profile's decoder (IX2-T4): which decode route the thumbnail and filmstrip take where the plan
   * names no hardware decoder (Windows: NVDEC, else D3D11VA). A Mac's plans name VideoToolbox themselves.
   */
  readonly decodeProfile?: DecodeProfileSource;
  /**
   * The hardware video rows the host's probe names for this machine (`engineHardwareBackends`): narrows the
   * platform's rows before their device trials run, once per service. Without one, the platform's default rows
   * are proven by trial alone.
   */
  readonly videoBackends?: NamedVideoBackends;
}

export function createMediaService({
  resolver,
  runner,
  onBackendFallback,
  onComputeFallback,
  cache,
  stillReader,
  hardwareSessions,
  speechPcm,
  decodeProfile,
  videoBackends,
}: MediaServiceDeps): MediaService {
  const counts: Record<string, number> = {};
  const hardwareFailures = new HardwareFailures();
  const toneMaps = new ToneMapSelection();
  const encoders = new EncoderSelection();
  const machine = new VideoBackendSelection(videoBackends);
  const countFallback = (fallback: BackendFallback) => {
    const key = `${fallback.operation}:${fallback.reason.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
    reportFallback(onBackendFallback, fallback);
  };
  // The runner, gated when the app caps hardware sessions.
  const running = hardwareSessions
    ? hardwareSessionContext(hardwareSessions, runner)
    : runner
      ? { runner }
      : {};
  async function withContext<T>(fn: (ctx: MediaContext) => AsyncResult<T>): AsyncResult<T> {
    const binaries = await resolver.resolve();
    if (!binaries.ok) return binaries;
    const ctx = {
      binaries: binaries.value,
      onBackendFallback: countFallback,
      hardwareFailures,
      toneMaps,
      encoders,
      videoBackends: machine,
      ...(onComputeFallback ? { onComputeFallback } : {}),
    };
    return fn({ ...ctx, ...running });
  }
  const host = {
    withContext,
    ...(cache ? { cache } : {}),
    ...(stillReader ? { stillReader } : {}),
    ...(speechPcm ? { speechPcm } : {}),
    ...(decodeProfile ? { decodeProfile } : {}),
  };
  return {
    binaries: () => resolver.resolve(),
    probe: (path, options) => withContext((ctx) => probeMedia(path, ctx, options)),
    extractFrame: (path, at, options) => withContext((ctx) => extractFrame(path, at, ctx, options)),
    detectEncoders: (options) => withContext((ctx) => detectEncoders(ctx, options)),
    selectEncoder: (codec, options) => withContext((ctx) => selectWorkingEncoder(ctx, codec, options)),
    selectToneMap: (options) => withContext((ctx) => toneMaps.get(ctx, options)),
    runFfmpeg: (args, options) => withContext((ctx) => runFfmpeg(ctx, args, options)),
    fallbackCounts: () => ({ ...counts }),
    normalise: (input) => normaliseAsset(input, host),
    makeProxy: (input) => proxyAsset(input, host),
    makePreviews: (input) => previewsAsset(input, host),
    makeFilmstrip: (input) => filmstripAsset(input, host),
    makeThumbnail: (input) => thumbnailAsset(input, host),
    conform: (input) => conformAsset(input, host),
    enforceCacheCap: (input) => enforceCache(input, host),
  };
}
