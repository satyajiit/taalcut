// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Backend selection for decode and encode (ADR 0002: GPU first). The hardware
 * backend is the default whenever the platform has one that can take the job;
 * software is the fallback for the impossible case and always carries a
 * reason. This is the only place in the package that decides. The shared
 * selection helper planned for @taalcut/core will take over the plumbing
 * (reason type, reporting), not these rules.
 */
import { err, ok, type Result } from '@taalcut/core';
import { NoEncoder } from './errors';
import { hardwareBackends, hardwareEncoderFor, hwVideoBackend } from './hw-video/table';
import type { EncodeCodec, HardwareBackend, MachineVideoBackends, MediaBackend } from './hw-video/types';
import type { VideoStreamInfo } from './probe/types';
import { ffmpegEncoderName, softwareEncoderFor, softwareEncodersFor } from './software-encoders';

export { hardwareBackends } from './hw-video/table';
export { videoToolboxSurfaceFormat } from './hw-video/surface';
export { softwareEncoderFor } from './software-encoders';
export type { EncodeCodec, HardwareBackend, MediaBackend } from './hw-video/types';

/**
 * Why a job ran on the CPU:
 * - requested: the caller asked for software (diagnostics, tests);
 * - no_hardware_backend: no hardware backend for this platform, or none on this machine (its device trial failed,
 *   or the hardware probe found no GPU video engine: `CUDA_VISIBLE_DEVICES=-1`);
 * - codec_unsupported: the hardware path has no decoder or encoder for this codec;
 * - format_unsupported: a pixel format, chroma layout or bit depth the hardware path can't carry;
 * - encoder_missing: the FFmpeg build lacks the hardware encoder;
 * - hardware_failed: the hardware path failed when run (a VM without a GPU, a profile this chip can't decode);
 * - filter_missing: the FFmpeg build lacks the GPU filter (libplacebo for the HDR tone-map);
 * - vulkan_unavailable: no Vulkan device for libplacebo (no bundled MoltenVK, or the loader refused
 *   it: VK_ERROR_INCOMPATIBLE_DRIVER under the hardened runtime without a matching Team ID).
 */
export const FALLBACK_CODES = [
  'requested',
  'no_hardware_backend',
  'codec_unsupported',
  'format_unsupported',
  'encoder_missing',
  'hardware_failed',
  'filter_missing',
  'vulkan_unavailable',
] as const;
export type FallbackCode = (typeof FALLBACK_CODES)[number];

export interface FallbackReason {
  readonly code: FallbackCode;
  /** One line for the developer trace. */
  readonly detail: string;
}

export interface BackendChoice {
  readonly backend: MediaBackend;
  /** Set whenever `backend` is 'software'. */
  readonly fallbackReason?: FallbackReason;
}

/** One software fallback, for logging and counting. */
export interface BackendFallback {
  readonly operation: 'decode' | 'encode' | 'tonemap';
  /** A file name (never a full path), a codec, or 'hdr' for the tone-map. */
  readonly subject: string;
  readonly reason: FallbackReason;
}

export type BackendFallbackListener = (fallback: BackendFallback) => void;

/** Calls the listener, or logs when there is none: a software route is never silent. */
export function reportFallback(
  listener: BackendFallbackListener | undefined,
  fallback: BackendFallback,
): void {
  if (!listener) {
    const { operation, subject, reason } = fallback;
    console.warn(`[media] ${operation} on the CPU for ${subject}: ${reason.code} (${reason.detail})`);
    return;
  }
  try {
    listener(fallback);
  } catch (cause) {
    console.error('[media] backend fallback listener threw', cause);
  }
}

/** The first lines of an FFmpeg error: enough to say why the hardware gave up (the rest is format lists). */
export function failureGist(stderr: string): string {
  const lines = stderr.split('\n').filter((line) => line.trim().length > 0);
  const gist = lines.slice(0, 2).map((line) => line.trim().slice(0, 200));
  return gist.join(' / ') || 'no error output';
}

/**
 * Remembers hardware failures for the life of a MediaService, keyed by what
 * the hardware choked on (codec, profile, pixel format), so a batch of frames
 * from one clip pays for the failed attempt once.
 */
export class HardwareFailures {
  private readonly failures = new Map<string, FallbackReason>();

  static key(video: DecodeSource): string {
    return [video.codec, video.profile, video.pixelFormat].map((part) => part ?? '?').join('|');
  }

  recall(video: DecodeSource): FallbackReason | undefined {
    return this.failures.get(HardwareFailures.key(video));
  }

  remember(video: DecodeSource, reason: FallbackReason): void {
    this.failures.set(HardwareFailures.key(video), reason);
  }
}

// ---- Decode ----------------------------------------------------------------

/** What decode planning reads of a stream. */
export type DecodeSource = Pick<VideoStreamInfo, 'codec' | 'profile' | 'pixelFormat'>;

/** A hardware row's decode (frames stay on its device until `surfaceFormat` downloads), or the CPU with why. */
export type DecodePlan =
  | { readonly backend: HardwareBackend; readonly surfaceFormat: string }
  | { readonly backend: 'software'; readonly fallbackReason: FallbackReason };

export interface DecodePlanOptions {
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** 'software' skips the hardware (diagnostics, tests). Default 'auto'. */
  readonly decode?: 'auto' | 'software';
  readonly failures?: HardwareFailures;
  /** The machine's rows (`MediaContext.videoBackends`, proven). Default: the platform's default rows. */
  readonly machine?: MachineVideoBackends;
  /** A still (one frame): only rows that decode stills take it. */
  readonly still?: boolean;
}

/** The first of the machine's rows that can take `video`; else the CPU, with the first row's reason. */
export function planDecode(video: DecodeSource, options: DecodePlanOptions = {}): DecodePlan {
  const software = (code: FallbackCode, detail: string): DecodePlan => ({
    backend: 'software',
    fallbackReason: { code, detail },
  });
  if (options.decode === 'software') return software('requested', 'software decode requested');
  if (options.machine?.disabled) return software('requested', options.machine.disabled);
  const platform = options.platform ?? process.platform;
  const rows = (options.machine?.backends ?? hardwareBackends(platform)).flatMap((id) => {
    const decode = hwVideoBackend(id).decode;
    return decode ? [{ id, decode }] : [];
  });
  if (rows.length === 0) {
    const missing = options.machine?.missing;
    const detail = options.machine
      ? `no hardware video decoder on this machine${missing ? ` (${missing})` : ''}`
      : `no hardware decoder wired up for ${platform} yet`;
    return software('no_hardware_backend', detail);
  }
  const codec = video.codec ?? 'unknown';
  let first: DecodePlan | undefined;
  for (const { id, decode } of rows) {
    const surfaceFormat = decode.surfaceFormat(video);
    let refused: DecodePlan | undefined;
    if (options.still && !decode.stills)
      refused = software('format_unsupported', `${decode.label} doesn't decode stills`);
    else if (!decode.codecs.has(codec))
      refused = software('codec_unsupported', `${decode.label} has no ${codec} decoder`);
    else if (!surfaceFormat) {
      const format = video.pixelFormat ?? 'an unknown pixel format';
      refused = software('format_unsupported', `${decode.label} can't carry ${format}`);
    }
    if (!refused) {
      const earlier = options.failures?.recall(video);
      if (earlier) return software('hardware_failed', `failed earlier for this format: ${earlier.detail}`);
      return { backend: id, surfaceFormat: surfaceFormat! };
    }
    first ??= refused;
  }
  return first!;
}

// ---- Encode ----------------------------------------------------------------

export interface EncoderInfo {
  readonly name: string;
  readonly type: 'video' | 'audio' | 'subtitle';
  /** The codec it produces, e.g. 'h264' for h264_nvenc. */
  readonly codec: string;
  readonly description: string;
  readonly experimental: boolean;
  /** Uses a platform hardware API (VideoToolbox, NVENC, QSV, AMF, Media Foundation, VAAPI…). */
  readonly hardware: boolean;
}

export interface EncoderSupport {
  readonly encoders: readonly EncoderInfo[];
  readonly h264VideoToolbox: boolean;
  readonly hevcVideoToolbox: boolean;
  /** Each hardware row's encoders this build has, by row: `{ cuda: ['h264_nvenc', 'hevc_nvenc'], … }`. */
  readonly hardware: Readonly<Partial<Record<HardwareBackend, readonly string[]>>>;
  readonly libopenh264: boolean;
  /**
   * Best H.264 encoder compiled in, in the platform's row order (`platform`, default this one): its hardware rows'
   * encoders, then OpenH264 (LGPL build), then x264 (GPL builds). Compiled in, not proven: `selectWorkingEncoder`.
   */
  readonly preferredH264?: string;
  /** Best HEVC encoder compiled in: the platform's hardware rows', then x265 (GPL builds). */
  readonly preferredHevc?: string;
  /** Best AV1 encoder compiled in: the platform's hardware rows', then SVT-AV1 (LNX1-AV1). */
  readonly preferredAv1?: string;
}

export interface EncoderChoice extends BackendChoice {
  readonly codec: EncodeCodec;
  /** Encoder route, resolved by videoEncodeFlags; software VideoToolbox has a distinct CPU identifier. */
  readonly encoder: string;
}

export interface EncoderSelectOptions {
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Skip the hardware (diagnostics, tests). */
  readonly software?: boolean;
  /** Hardware encoders that failed a trial encode or a real one, with why. */
  readonly failed?: Readonly<Record<string, string>>;
  /** The machine's rows (`MediaContext.videoBackends`, proven). Default: the platform's default rows. */
  readonly machine?: MachineVideoBackends;
}

export interface WorkingEncoderOptions extends EncoderSelectOptions {
  /** From an earlier `detectEncoders`; detected now when absent. */
  readonly support?: EncoderSupport;
  readonly signal?: AbortSignal;
  /** Per trial encode. Default 15 s. */
  readonly timeoutMs?: number;
}

/**
 * Picks the encoder for `codec` from what the build has (`available` is
 * `EncoderSupport.encoders`, or any list of `{ name }`): the platform's
 * hardware encoders in order, then the LGPL software fallback carrying the
 * reason the hardware was passed over. `media.no_encoder` when neither works.
 */
export function selectEncoder(
  codec: EncodeCodec,
  available: readonly { readonly name: string }[],
  options: EncoderSelectOptions = {},
): Result<EncoderChoice> {
  const has = (name: string) => available.some((encoder) => encoder.name === name);
  const platform = options.platform ?? process.platform;
  const reasons: FallbackReason[] = [];
  const machine = options.machine;
  const rows = (machine?.backends ?? hardwareBackends(platform)).filter((id) => hwVideoBackend(id).encode);
  const hardware = options.software ? [] : rows;
  if (options.software) reasons.push({ code: 'requested', detail: 'software encode requested' });
  else if (machine?.disabled) reasons.push({ code: 'requested', detail: machine.disabled });
  else if (hardware.length === 0) {
    const detail = machine
      ? `no hardware video encoder on this machine${machine.missing ? ` (${machine.missing})` : ''}`
      : `no hardware encoder wired up for ${platform} yet`;
    reasons.push({ code: 'no_hardware_backend', detail });
  }
  for (const backend of hardware) {
    const encoder = hardwareEncoderFor(backend, codec);
    if (!encoder) {
      reasons.push({ code: 'codec_unsupported', detail: `the ${backend} row has no ${codec} encoder` });
      continue;
    }
    const failure = options.failed?.[encoder];
    if (!has(encoder))
      reasons.push({ code: 'encoder_missing', detail: `${encoder} is not in this FFmpeg build` });
    else if (failure !== undefined)
      reasons.push({ code: 'hardware_failed', detail: `${encoder}: ${failure}` });
    else return ok({ codec, encoder, backend });
  }
  const softwareEncoders = softwareEncodersFor(codec, platform);
  const fallback = softwareEncoders.find((encoder) => has(ffmpegEncoderName(encoder)));
  const reason = reasons.at(-1);
  if (fallback && reason)
    return ok({ codec, encoder: fallback, backend: 'software', fallbackReason: reason });
  const software = softwareEncoders.join(', ') || 'none allowed';
  const detail = [
    ...reasons.map((r) => `${r.code}: ${r.detail}`),
    `software fallback: ${software}, not in build`,
  ];
  return err(NoEncoder({ codec }, { detail: detail.join('\n') }));
}

/**
 * The encoder for a frame of `size`: `choice`, unless its row can't open that small a frame (NVENC's minimum), then
 * the LGPL CPU encoder with `format_unsupported`. HEVC has none: `media.no_encoder`.
 */
export function encoderForSize(
  choice: EncoderChoice,
  size: { readonly width: number; readonly height: number },
): Result<EncoderChoice> {
  if (choice.backend === 'software') return ok(choice);
  const min = hwVideoBackend(choice.backend).encode?.minimumSize?.[choice.codec];
  if (!min || (size.width >= min.width && size.height >= min.height)) return ok(choice);
  const detail = `${choice.encoder} needs at least ${min.width}×${min.height}, this is ${size.width}×${size.height}`;
  const fallback = softwareEncoderFor(choice.codec, choice.backend === 'videotoolbox' ? 'darwin' : 'linux');
  if (!fallback) return err(NoEncoder({ codec: choice.codec }, { detail }));
  const fallbackReason: FallbackReason = { code: 'format_unsupported', detail };
  return ok({ codec: choice.codec, encoder: fallback, backend: 'software', fallbackReason });
}

// ---- HDR tone-map (the rules are in tonemap.ts) ----------------------------

export type ToneMapMethod = 'libplacebo' | 'zscale' | 'none';

export interface ToneMapChoice {
  /** 'none': this build has neither route (a development override); frames stay untone-mapped. */
  readonly method: ToneMapMethod;
  readonly backend: 'vulkan' | 'software';
  /** The curve: 'bt.2446a' on libplacebo, 'hable' on zscale. */
  readonly curve?: 'bt.2446a' | 'hable';
  /** Set whenever the method is not libplacebo. */
  readonly fallbackReason?: FallbackReason;
}

export interface ToneMapOptions {
  /** Skip the GPU (diagnostics, tests). */
  readonly software?: boolean;
  readonly signal?: AbortSignal;
  /** For the trial (MoltenVK starts in a few seconds). Default 30 s. */
  readonly timeoutMs?: number;
}
