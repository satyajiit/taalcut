// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ProbeResult: what Taalcut knows about a media file after one ffprobe call.
 * Plain data (no classes, no Buffers) so it crosses IPC and can be a tool result.
 * Every time is an exact RationalTime; frame rates and time bases are exact Rationals.
 */
import type { Rational } from '../rational';
import type { RationalTime } from '../rational-time';

export type HdrFormat = 'hlg' | 'pq' | 'dolby_vision';

export interface DolbyVisionInfo {
  readonly profile: number;
  readonly level?: number;
  /** Base-layer compatibility: 1 HDR10, 2 SDR, 4 HLG (iPhone is profile 8.4: HLG-compatible). */
  readonly compatibilityId?: number;
  readonly rpuPresent?: boolean;
  readonly enhancementLayerPresent?: boolean;
  readonly baseLayerPresent?: boolean;
}

export interface ColourInfo {
  /** 'tv' (limited) or 'pc' (full). */
  readonly range?: string;
  /** Matrix coefficients, e.g. 'bt709', 'bt2020nc'. */
  readonly space?: string;
  /** Transfer characteristics, e.g. 'bt709', 'arib-std-b67' (HLG), 'smpte2084' (PQ). */
  readonly transfer?: string;
  readonly primaries?: string;
}

/** Fields every stream has. */
export interface StreamBase {
  readonly index: number;
  readonly codec?: string;
  readonly codecLongName?: string;
  readonly timeBase?: Rational;
  readonly startTime?: RationalTime;
  readonly duration?: RationalTime;
  readonly bitRate?: number;
  readonly language?: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface VideoStreamInfo extends StreamBase {
  readonly kind: 'video';
  readonly profile?: string;
  /** Coded size, before rotation. */
  readonly width: number;
  readonly height: number;
  /** Size as shown: width and height swapped for 90° and 270° rotations. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /** Degrees to rotate the coded frame clockwise for display: an iPhone portrait clip is 90. */
  readonly rotation: 0 | 90 | 180 | 270;
  /**
   * True when the display matrix mirrors (determinant of the upper 2×2 below 0).
   * Absent on probes mapped before this field existed; treat absence as false.
   */
  readonly mirrored?: boolean;
  readonly pixelFormat?: string;
  readonly bitDepth?: number;
  readonly colour: ColourInfo;
  readonly isHdr: boolean;
  /** Every HDR signal found; an iPhone clip is ['hlg', 'dolby_vision']. */
  readonly hdrFormats: readonly HdrFormat[];
  readonly dolbyVision?: DolbyVisionInfo;
  /** r_frame_rate: the base rate all timestamps fit, exact (30000/1001, not 29.97). */
  readonly frameRate?: Rational;
  /** avg_frame_rate: frames divided by duration. */
  readonly averageFrameRate?: Rational;
  /** True when the two rates differ at all: probably variable frame rate (phone video). */
  readonly vfrHint: boolean;
  readonly frameCount?: number;
  /** Cover art or a thumbnail track, not real video. */
  readonly isAttachedPicture: boolean;
}

export interface AudioStreamInfo extends StreamBase {
  readonly kind: 'audio';
  readonly profile?: string;
  readonly channels?: number;
  readonly channelLayout?: string;
  readonly sampleRate?: number;
  readonly sampleFormat?: string;
}

export interface OtherStreamInfo extends StreamBase {
  readonly kind: 'subtitle' | 'data' | 'attachment' | 'unknown';
}

export type StreamInfo = VideoStreamInfo | AudioStreamInfo | OtherStreamInfo;

export interface ChapterInfo {
  readonly id: number;
  readonly start: RationalTime;
  readonly end: RationalTime;
  readonly title?: string;
}

/** Metadata phones write into the container: Apple QuickTime keys, Android and Samsung keys and boxes (LIB1-OEM). */
export interface PhoneMetadata {
  readonly make?: string;
  readonly model?: string;
  readonly software?: string;
  /** Local capture time with its UTC offset, e.g. '2026-10-01T15:30:00+0530'. */
  readonly creationDate?: string;
  /** ISO 6709 location string, e.g. '+19.0760+072.8777+010.000/'. */
  readonly location?: string;
  /** Android capture rate for slow motion, e.g. 240. */
  readonly captureFrameRate?: number;
  /** Apple content identifier that pairs a Live Photo's video with its still. */
  readonly livePhotoId?: string;
  /** Samsung's UTC offset at capture, as written: '+0200' (`com.samsung.android.utc_offset`). */
  readonly utcOffset?: string;
  /** Samsung's model number: 'SM-X000Z' (`udta/smta/mdln`). */
  readonly modelCode?: string;
  /** The lens Apple names: 'iPhone 14 Pro back camera 2.22mm f/2.2' (the video track's `camera.lens_model`). */
  readonly lens?: string;
  /** Apple's 35 mm equivalent focal length in mm (the video track's `camera.focal_length.35mm_equivalent`). */
  readonly focalLength35mm?: number;
  /** Apple's capture mode as Photos names it (the video track's `com.apple.photos.captureMode`). */
  readonly captureMode?: string;
  /** The app that wrote the file, when its comment says: 'Sample Cam' (`app=Sample Cam&device=…`). */
  readonly app?: string;
  /** The device that app names in the same comment: 'XC01'. */
  readonly appDevice?: string;
}

export interface ContainerInfo {
  /** ffprobe's demuxer name list, e.g. 'mov,mp4,m4a,3gp,3g2,mj2'. */
  readonly formatName: string;
  readonly longName?: string;
  /** ISO base media major brand, e.g. 'qt  ' for an iPhone .mov. */
  readonly majorBrand?: string;
  readonly sizeBytes?: number;
  readonly bitRate?: number;
}

export interface ProbeResult {
  /** Absolute path that was probed. */
  readonly path: string;
  readonly container: ContainerInfo;
  /** Container duration, exact to the microsecond ({ value: µs, rate: 1_000_000 }). */
  readonly duration?: RationalTime;
  readonly startTime?: RationalTime;
  readonly streams: readonly StreamInfo[];
  /** The first video stream that is not cover art. */
  readonly video?: VideoStreamInfo;
  /** The first audio stream. */
  readonly audio?: AudioStreamInfo;
  readonly chapters: readonly ChapterInfo[];
  /** Capture time as written by the device (ISO 8601; phone local time with offset when available). */
  readonly creationTime?: string;
  readonly phone?: PhoneMetadata;
  /** Container-level tags as ffprobe reports them. */
  readonly tags: Readonly<Record<string, string>>;
}
