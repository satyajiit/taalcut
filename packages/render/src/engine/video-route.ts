// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's FFmpeg jobs on media's hardware video table (LNX1-RND; ADR 0002: GPU first). The machine's rows are
 * media's answer (`machineVideoBackends`: the host's probe and each row's device trial, else the platform's default
 * rows); a file's decode is media's `planDecode` on them, and the encoder is media's `selectWorkingEncoder` (a trial
 * encode proves it), sized by `encoderForSize`. Nothing here or in the graphs names a backend: segment-args.ts
 * builds them from the row through media's filter builders. Every CPU choice made before a run is one
 * `compute.fallback` with its reason; a hardware run that fails runs again on softwareVideoRoute (hardware-route.ts).
 */
import {
  computeFallbackEvent,
  cpuFallback,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type ComputeFallbackReason,
} from '@taalcut/core';
import {
  backendOfEncoder,
  encoderForSize,
  hardwareBackends,
  hwVideoBackend,
  machineVideoBackends,
  planDecode,
  selectWorkingEncoder,
  softwareEncoderFor,
  type EncodeCodec,
  type EncoderChoice,
  type FallbackCode,
  type FallbackReason,
  type HardwareBackend,
  type MachineVideoBackends,
  type MediaContext,
  type VideoStreamInfo,
} from '@taalcut/media';

/** A job's decode: a hw-video row (frames stay on its device until the download, in `surfaceFormat`), or the CPU. */
export type RouteDecode =
  { readonly backend: HardwareBackend; readonly surfaceFormat: string } | { readonly backend: 'software' };

/** How one render FFmpeg job decodes, and the encoder that writes it. */
export interface VideoRoute {
  readonly decode: RouteDecode;
  /** Media's encoder route; videoEncodeFlags resolves software VideoToolbox to its FFmpeg flags. */
  readonly encoder: string;
}

/** The software retry's route: no hardware decoder or encoder at all (IX3-K4). */
export function softwareVideoRoute(platform?: NodeJS.Platform): VideoRoute {
  return { decode: { backend: 'software' }, encoder: softwareEncoderFor('h264', platform)! };
}

/** Whether a route opens a hardware decoder or encoder: a stop never kills such a run (IX3-K2). */
export function usesHardware(route: VideoRoute): boolean {
  return route.decode.backend !== 'software' || backendOfEncoder(route.encoder) !== undefined;
}

/** The name a route's hardware goes by in a retry's detail: 'VideoToolbox', 'NVDEC/NVENC'. */
export function hardwareLabel(route: VideoRoute): string {
  const decode = route.decode.backend === 'software' ? undefined : hwVideoBackend(route.decode.backend);
  const encode = backendOfEncoder(route.encoder);
  const labels = [decode?.decode?.label, encode ? encodeLabel(encode.id) : undefined];
  return [...new Set(labels.filter((label): label is string => label !== undefined))].join('/') || 'hardware';
}

const encodeLabel = (id: HardwareBackend) =>
  id === 'cuda' ? 'NVENC' : (hwVideoBackend(id).decode?.label ?? id.toUpperCase());

/**
 * core's name for the machine's GPU where no hw-video row is the subject (Chrome's raster, a filter with no GPU
 * version): Metal on a Mac, Vulkan elsewhere.
 */
export function platformGpu(platform: NodeJS.Platform = process.platform): ComputeBackend[] {
  return platform === 'darwin' ? ['metal'] : ['vulkan'];
}

/** core's compute names of the platform's rows for one side: what a CPU choice was wanted instead of. */
export function wantedFor(ctx: Pick<MediaContext, 'platform'>, side: 'decode' | 'encode'): ComputeBackend[] {
  const rows = hardwareBackends(ctx.platform ?? process.platform).filter((id) => hwVideoBackend(id)[side]);
  return [...new Set(rows.map((id) => hwVideoBackend(id).compute[side]))];
}

/** The compute names a route asks for (its hardware decode and encode), for a retry's `compute.fallback`. */
export function wantedBy(route: VideoRoute): ComputeBackend[] {
  const decode =
    route.decode.backend === 'software' ? [] : [hwVideoBackend(route.decode.backend).compute.decode];
  const encode = backendOfEncoder(route.encoder)?.compute.encode;
  return [...new Set([...decode, ...(encode ? [encode] : [])])];
}

/** media's fallback code as core's reason (media's own mapping, compute-report.ts). */
export function fallbackReasonOf(code: FallbackCode): ComputeFallbackReason {
  switch (code) {
    case 'requested':
      return 'disabled';
    case 'codec_unsupported':
    case 'format_unsupported':
      return 'unsupported_input';
    case 'hardware_failed':
      return 'accelerator_failed';
    default:
      return 'no_accelerator';
  }
}

/** One `compute.fallback` for a CPU choice media made, with its reason. */
export function fallbackEvent(
  operation: string,
  wanted: readonly ComputeBackend[],
  reason: FallbackReason,
): ComputeFallbackEvent {
  return computeFallbackEvent(
    operation,
    wanted,
    cpuFallback(fallbackReasonOf(reason.code), reason.detail.slice(0, 2000)).fallback!,
  );
}

/** The machine's rows: media's proven answer, else the platform's default rows. */
export function machineOf(ctx: MediaContext, signal?: AbortSignal): AsyncResult<MachineVideoBackends> {
  return machineVideoBackends(ctx, signal);
}

export interface PlannedDecode {
  readonly decode: RouteDecode;
  /** Set when the plan took the CPU: why. */
  readonly fallback?: ComputeFallbackEvent;
}

/** A file's decode on the machine's rows (a still only on rows that decode stills), or the CPU with why. */
export function decodeOn(
  ctx: MediaContext,
  machine: MachineVideoBackends,
  video: Pick<VideoStreamInfo, 'codec' | 'profile' | 'pixelFormat'> | undefined,
  operation: string,
  options: { readonly still?: boolean } = {},
): PlannedDecode {
  const plan = video
    ? planDecode(video, {
        machine,
        ...(ctx.platform ? { platform: ctx.platform } : {}),
        ...(ctx.hardwareFailures ? { failures: ctx.hardwareFailures } : {}),
        ...(options.still ? { still: true } : {}),
      })
    : ({
        backend: 'software',
        fallbackReason: { code: 'format_unsupported', detail: 'no video stream' },
      } as const);
  if (plan.backend !== 'software')
    return { decode: { backend: plan.backend, surfaceFormat: plan.surfaceFormat } };
  return {
    decode: { backend: 'software' },
    fallback: fallbackEvent(operation, wantedFor(ctx, 'decode'), plan.fallbackReason),
  };
}

export interface PlannedEncoder {
  readonly choice: EncoderChoice;
  /** Set when the choice is a CPU encoder: why. */
  readonly fallback?: ComputeFallbackEvent;
}

/**
 * The working encoder for `codec` at `size` (media's trial-proven pick, remembered by `ctx.encoders`), or the CPU
 * encoder with why. HEVC has no CPU encoder in the LGPL build: `media.no_encoder`. No size: any size the job has
 * already been encoded at (a segment the conform wrote).
 */
export async function encoderFor(
  ctx: MediaContext,
  codec: EncodeCodec,
  size: { readonly width: number; readonly height: number } | undefined,
  operation: string,
  signal?: AbortSignal,
): AsyncResult<PlannedEncoder> {
  const selected = await selectWorkingEncoder(ctx, codec, signal ? { signal } : {});
  if (!selected.ok) return selected;
  const sized = size ? encoderForSize(selected.value, size) : selected;
  if (!sized.ok) return sized;
  const choice = sized.value;
  if (!choice.fallbackReason) return ok({ choice });
  return ok({ choice, fallback: fallbackEvent(operation, wantedFor(ctx, 'encode'), choice.fallbackReason) });
}

export interface PlannedRoute {
  readonly route: VideoRoute;
  /** The CPU choices made before the run (the decode's, the encoder's), one `compute.fallback` each. */
  readonly fallbacks: readonly ComputeFallbackEvent[];
}

/** A whole job's first route: the file's decode and the H.264 (or HEVC) encoder, each GPU first. */
export async function planVideoRoute(
  ctx: MediaContext,
  request: {
    readonly video: Pick<VideoStreamInfo, 'codec' | 'profile' | 'pixelFormat'> | undefined;
    readonly codec: EncodeCodec;
    readonly size?: { readonly width: number; readonly height: number };
    /** `compute.fallback`'s operations: `<operation>Decode` and `<operation>Encode`. */
    readonly operation: string;
    readonly signal?: AbortSignal;
  },
): AsyncResult<PlannedRoute> {
  const machine = await machineOf(ctx, request.signal);
  if (!machine.ok) return machine;
  const decoded = decodeOn(ctx, machine.value, request.video, `${request.operation}Decode`);
  const encoder = await encoderFor(
    ctx,
    request.codec,
    request.size,
    `${request.operation}Encode`,
    request.signal,
  );
  if (!encoder.ok) return encoder;
  return ok({
    route: { decode: decoded.decode, encoder: encoder.value.choice.encoder },
    fallbacks: [decoded.fallback, encoder.value.fallback].filter(
      (event): event is ComputeFallbackEvent => event !== undefined,
    ),
  });
}
