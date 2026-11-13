// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hardware video as data (plan/linux-round-1.md, seam 3). One `HwVideoBackend` row per decoder/encoder family:
 * the hwaccel arguments and the device frames' format, the upright and scale filters that run on the device,
 * the download step, the encoder names and their flags, and how to prove the device opens. Media's planning,
 * graphs, frame reads, encoders and compute reports read the row; render reads the same rows through the public
 * builders (filters.ts). No code branches on a backend's name.
 */
import type { ComputeBackend } from '@taalcut/core';

/** Every row, tested or not. `d3d11va`, `qsv`, `amf` and `mf` are Windows slots: typed, never selected yet. */
export const HW_VIDEO_BACKEND_IDS = ['videotoolbox', 'cuda', 'vaapi', 'd3d11va', 'qsv', 'amf', 'mf'] as const;
export type HardwareBackend = (typeof HW_VIDEO_BACKEND_IDS)[number];

/** The backends a decode or encode reports: a hardware row, or the CPU. */
export const MEDIA_BACKENDS = [...HW_VIDEO_BACKEND_IDS, 'software'] as const;
export type MediaBackend = (typeof MEDIA_BACKENDS)[number];

/** AV1 (LNX1-AV1) is an export codec only, on a hardware encoder; the CPU's SVT-AV1 is its runtime fallback. */
export type EncodeCodec = 'h264' | 'hevc' | 'av1' | 'prores';

/**
 * What an encode is for, which sets its speed and quality trade:
 * - proxy: fast, closed short GOP, no B-frames (scrubbing and previews);
 * - conform: the full-quality copy media keeps, closed GOP and no B-frames (the drift measurement needs no
 *   reordering delay), at the quality preset;
 * - export: a finished file (render's finish), quality preset, B-frames and lookahead where the encoder has them.
 */
export type EncodePurpose = 'proxy' | 'conform' | 'export';

/** HDR transfer for a 10-bit export (HEVC Main10, or AV1 Main 10-bit): HLG or PQ, BT.2020 primaries and matrix. */
export type HdrTransfer = 'hlg' | 'pq';

export interface EncodeFlagInput {
  readonly encoder: string;
  readonly purpose: EncodePurpose;
  readonly videoBps: number;
  readonly gop: number;
  /**
   * Frames reach the encoder on the device (CUDA frames into NVENC): no `-pix_fmt` and no colour options, which
   * would put a CPU format filter in front of the encoder. The bitstream filter writes the colour tags instead.
   */
  readonly deviceFrames?: boolean;
  /** A 10-bit HDR export (HEVC Main10, AV1 Main 10-bit). SDR BT.709 otherwise. */
  readonly hdr?: HdrTransfer;
}

export interface HwDecode {
  /** Name in fallback details: 'VideoToolbox', 'NVDEC', 'VA-API'. */
  readonly label: string;
  /** `-hwaccel` value. */
  readonly hwaccel: string;
  /** `-hwaccel_output_format` value: the device's frame format. */
  readonly outputFormat: string;
  /** Codecs FFmpeg can hand to this decoder. Whether this machine decodes a profile is only known by trying. */
  readonly codecs: ReadonlySet<string>;
  /**
   * Whether stills (HEIC's HEVC tiles, one frame) decode here. VideoToolbox does on every Mac; elsewhere a still is
   * one frame, which the device's setup costs more than, and tile grids aren't tested on it: stills take the CPU.
   */
  readonly stills: boolean;
  /** The format `hwdownload` names for a stream; undefined when the decoder can't carry it. */
  surfaceFormat(video: { readonly codec?: string; readonly pixelFormat?: string }): string | undefined;
  /**
   * What frames download as before a CPU filter: `surface` for 8-bit SDR; `deep` (10-bit or HDR) frames as the
   * device can give them (VideoToolbox converts to P010 on the way down; CUDA hands back its own format only).
   */
  downloadFormat(surface: string, deep: boolean): string;
  /** The device's transpose filter (directions clock, cclock, reversal); undefined: turned on the CPU. */
  readonly transpose?: string;
  /** The device's scale to a size; undefined: scaled on the CPU after the download. */
  scale?(width: number, height: number): string;
  /** Whether `-skip_frame nokey` works: true for an `-hwaccel` on FFmpeg's own decoders (IX2-T1). */
  readonly honoursSkipFrame: boolean;
}

export interface HwEncode {
  /** The encoder for each codec this row has one for. */
  readonly encoders: Partial<Readonly<Record<EncodeCodec, string>>>;
  /** The encoders take this row's decoded device frames without a download (zero copy: CUDA into NVENC). */
  readonly takesDeviceFrames: boolean;
  /** The smallest frame each encoder opens with (NVENC refuses below it); smaller goes to the CPU encoder. */
  readonly minimumSize?: Partial<
    Readonly<Record<EncodeCodec, { readonly width: number; readonly height: number }>>
  >;
  /** The flags after `-c:v <encoder>`'s neighbours: rate control, GOP, profile, colour, bitstream filter. */
  flags(input: EncodeFlagInput): string[];
  /**
   * The encoders take device frames only (VA-API): frames on the CPU go up first. `inputArgs` open the device
   * (before `-i`); `filters` end the video chain.
   */
  readonly upload?: { readonly inputArgs: readonly string[]; readonly filters: readonly string[] };
  /** Ten frames through `encoder` (after the prelude), to prove it opens. Default: a lavfi pattern, `-f null`. */
  trialArgs?(encoder: string): string[];
}

export interface HwVideoBackend {
  readonly id: HardwareBackend;
  /** core's compute names, for `compute.fallback` and the trace. */
  readonly compute: { readonly decode: ComputeBackend; readonly encode: ComputeBackend };
  readonly decode?: HwDecode;
  readonly encode?: HwEncode;
  /**
   * One short run through the device (upload, scale, download) that proves it opens on this machine, run once
   * per MediaService before a plan uses the row. Undefined: none needed (VideoToolbox is on every Mac).
   */
  readonly deviceTrial?: readonly string[];
  /** Run on real hardware this round. False rows are typed and unit-tested on their arguments only. */
  readonly verified: boolean;
}

/** The hardware video backends this machine can use, in order, and why the platform's others are out. */
export interface MachineVideoBackends {
  readonly backends: readonly HardwareBackend[];
  /** Why rows the platform tries are missing, for fallback details: `cuda: cuInit(0) failed -> CUDA_ERROR_NO_DEVICE`. */
  readonly missing?: string;
  /**
   * Hardware video is turned off on purpose (`TAALCUT_FORCE_CPU=1`), and why: `backends` is empty and every CPU
   * choice records `requested` (core's `disabled`), not a missing accelerator.
   */
  readonly disabled?: string;
}
