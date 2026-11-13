// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/media: FFmpeg wrapper, probe, normalise, proxies, hardware encode selection.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/media' and never from a path inside src/. See SPEC.md.
 *
 * Each area has its own entry file (`<area>/index.ts`), re-exported whole here,
 * so an area's public names are listed beside its code.
 */

// Time (RationalTime moves to @taalcut/core; see rational-time.ts).
export type { RationalTime } from './rational-time';
export type { Rational } from './rational';
export { parseRational, rationalEquals, rationalToNumber, toSeconds } from './rational';

// Errors.
export {
  CachePinnedOverCap,
  CacheUnavailable,
  DecodeFailed,
  FfmpegBuildMismatch,
  FfmpegFailed,
  FfmpegLicenceRejected,
  FfmpegNotFound,
  fileParams,
  MediaCancelled,
  MediaFileNotFound,
  MediaTimeout,
  NoEncoder,
  OnnxFailed,
  OnnxUnavailable,
  OutputTooLarge,
  ProbeFailed,
  SpawnFailed,
  StillDecodeFailed,
  UnsupportedMedia,
  type FileParams,
} from './errors';

// Backend selection (ADR 0002: GPU first; CPU only with a reason).
export {
  FALLBACK_CODES,
  hardwareBackends,
  HardwareFailures,
  encoderForSize,
  planDecode,
  selectEncoder,
  softwareEncoderFor,
  type BackendChoice,
  type BackendFallback,
  type BackendFallbackListener,
  type DecodePlan,
  type DecodePlanOptions,
  type DecodeSource,
  type EncodeCodec,
  type EncoderChoice,
  type EncoderSelectOptions,
  type FallbackCode,
  type FallbackReason,
  type HardwareBackend,
  type MediaBackend,
} from './backends';

// Hardware video as data (seam 3): one row per backend, the platform tables, and the filter builders render uses.
export * from './hw-video';
export { progressBackend, SVT_AV1, videoEncodeFlags, type VideoEncodeOptions } from './encode-flags';
export { reportDecodeRoute, reportEncoderChoice } from './compute-report';

// Binary resolution, process runner, and hardware session limiter.
export * from './binaries';
export * from './process';
export {
  mediaEnv,
  runFfmpeg,
  type FfmpegRunOptions,
  type MediaContext,
  type VideoBackendSource,
} from './ffmpeg';
export * from './hardware-sessions';
export { detectFilters, parseFilters } from './filters';

// HDR tone-map (spike 07: libplacebo on Vulkan first, CPU zscale only with a reason).
export {
  LIBPLACEBO_TONEMAP,
  selectToneMap,
  TONEMAP_TRIAL_ARGS,
  toneMapFilters,
  ToneMapSelection,
  type ToneMapChoice,
  type ToneMapMethod,
  type ToneMapOptions,
} from './tonemap';
export { ProgressParser, throttleProgress, type FfmpegProgress, type ProgressListener } from './progress';

// Probe.
export { parseProbeJson, probeMedia, type ProbeOptions } from './probe/probe';
export { fileFingerprint, requireFile, stillPipeDemuxer, USER_MEDIA_DEMUXERS } from './input';
export type * from './probe/types';
export { probeResultSchema } from './probe/result-schema';

// Frames and encoders.
export {
  extractFrame,
  type ExtractedFrame,
  type ExtractFrameOptions,
  type FrameFormat,
} from './frames/extract-frame';
export { fitWithin } from './frames/frame-args';
export { imageSize, type ImageSize } from './frames/image-size';
export {
  detectEncoders,
  EncoderSelection,
  isHardwareEncoder,
  parseEncoders,
  selectWorkingEncoder,
  summariseEncoders,
  trialEncodeArgs,
  type EncoderInfo,
  type EncoderSupport,
  type WorkingEncoderOptions,
} from './encoders';
export {
  HARDWARE_ENCODE_CODECS,
  hardwareEncoders,
  type HardwareEncodeCodec,
  type HardwareEncoders,
} from './encode-capability';

// DI-friendly bundle and jobs (G7).
export { createMediaService, type MediaService, type MediaServiceDeps } from './service';
export * from './jobs';

// Agent tools (P1-G7).
export {
  createProbeTool,
  mediaToolModule,
  PROBE_TOOL_TIMEOUT_MS,
  type MediaToolDeps,
} from './tools/probe-tool';
export {
  probeInputSchema,
  probeOutputSchema,
  probeSummarySchema,
  rationalTimeSchema,
  type ProbeSummary,
  type ProbeToolInput,
  type ProbeToolOutput,
} from './tools/schemas';
export { describeProbeSummary, summariseProbe } from './tools/summary';

// The mac-helper sidecar (P2-L6): JSON-line client, resolver, still metadata.
export * from './sidecar';

// Normalisation, proxies, previews, keyframes, derived cache, and analysis primitives.
export * from './normalise';
export { makeProxy, type ProxyRequest, type ProxyResult } from './proxy/make-proxy';
export { proxyRate } from './proxy/ladder';
export * from './previews';
export {
  firstAtOrAfter,
  KEYFRAME_TAIL_SECONDS,
  KEYFRAME_WINDOW_GAP_SECONDS,
  keyframeWindows,
  type KeyframeWindow,
} from './keyframes/keyframe-windows';
export { keyframeArgs, type KeyframeGraphOptions } from './keyframes/keyframe-graph';
export { keyframeTimes } from './keyframes/keyframe-times';
export {
  decodeKeyframes,
  type DecodedKeyframes,
  type DecodeKeyframesOptions,
} from './keyframes/decode-keyframes';
export {
  createDerivedCache,
  type CacheClock,
  type DerivedCache,
  type DerivedCacheOptions,
} from './cache/cache';
export { derivedKey, hashFromKey, isContentHash, isDerivedKey, KIND_DIR } from './cache/layout';
export { createCapTrigger, type CapTrigger, type CapTriggerOptions } from './cache/cap-trigger';
export * from './primitives';

// ONNX Runtime and protobuf helpers.
export {
  createOnnxRuntime,
  onnxProvider,
  type CudaProviderOptions,
  type OnnxDeviceFailure,
  type OnnxModule,
  type OnnxProviderConfig,
  type OnnxRuntimeOptions,
  type OnnxSession,
  type OnnxSessionLike,
  type OpenSessionOptions,
} from './onnx/runtime';
// The machine's accelerators as vision and audio read them (LNX1 seam 1), and why a CUDA session didn't open.
export {
  canRun,
  cpuReasonFor,
  usableDevices,
  type AcceleratorApi,
  type MachineAccelerators,
} from './onnx/accelerators';
export {
  CUDA_PROVIDER_LIBRARIES,
  cudaFailureDetail,
  missingCudaLibraries,
  type LibrarySearch,
} from './onnx/cuda-libraries';
export { encodeOnnxModel, type OnnxGraph, type OnnxNode, type OnnxValue } from './onnx/protobuf';

// IX-D6: what each job spawned, for its output's `decodes` field.
export { classifyCommand, type CommandClass, type CommandKind } from './decode-count/classify';
export { decodeCountSchema, NO_DECODES, type DecodeCount } from './decode-count/schema';
export { countedContext, countingRunner, createDecodeTally, type DecodeTally } from './decode-count/tally';

// The one `media.analysisFilters` CPU record per process, for other packages' FFmpeg analysis passes (audio's).
export { reportAnalysisFilters } from './compute-report';

// IX-D1/D2: decode routes, frame sets in one run per seek window, analysis pass, and frame cache.
export * from './decode-routes';
export * from './frame-sets';
export * from './analysis-pass';
export * from './decode-service';
export {
  createFrameCache,
  FRAME_CACHE_LIMITS,
  type FrameCache,
  type FrameCacheHold,
  type FrameCacheLimits,
  type FrameCacheOptions,
} from './frame-cache/frame-cache';
export type { AssetFrames, FrameLocation } from './frame-cache/asset-frames';
