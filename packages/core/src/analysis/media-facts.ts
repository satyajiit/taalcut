// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What media's normalisation learned about an asset (P2-L4), and the files
 * media derives from an original (proxies, thumbnails, filmstrips, waveforms,
 * stills, conformed segments). The library stores both; the renderer,
 * timeline and render read them. A derived file is named by a key under the
 * media cache root, never by a path: main serves keys at app://media/<key>
 * (basics/csp.ts) and maps them inside the cache root only.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { frameRateSchema, type FrameRate } from '../time/frame-rate';
import { rationalTimeSchema, type RationalTime } from '../time/rational-time';

export const ORIENTATIONS = ['portrait', 'landscape', 'square'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const HDR_KINDS = ['none', 'hlg', 'pq', 'dolby-vision'] as const;
export type HdrKind = (typeof HDR_KINDS)[number];

/** UTC offsets in minutes run from UTC−12:00 (Baker Island) to UTC+14:00 (Kiribati). */
export const CAPTURE_OFFSET_MIN = -720;
export const CAPTURE_OFFSET_MAX = 840;

/**
 * Where a clip's UTC offset came from (LIB1-OEM): the file itself, or a clip from the same source shot within
 * hours of it that has one of its own ('nearby': a likely guess, shown as one).
 */
export const CAPTURE_OFFSET_FROM = ['file', 'nearby'] as const;
export type CaptureOffsetFrom = (typeof CAPTURE_OFFSET_FROM)[number];

/** A clip's UTC offset as the library settled it: from its own facts, or borrowed from a clip shot nearby. */
export const captureOffsetSchema = z.object({
  minutes: z.int().min(CAPTURE_OFFSET_MIN).max(CAPTURE_OFFSET_MAX),
  from: z.enum(CAPTURE_OFFSET_FROM),
});
export type CaptureOffset = z.output<typeof captureOffsetSchema>;

/** How playback at the grid rate relates to real time. */
export const SPEED_KINDS = ['normal', 'slow-motion', 'time-lapse'] as const;
export type SpeedKind = (typeof SPEED_KINDS)[number];

export interface MediaFacts {
  readonly version: 1;
  /** Upright (display) size. */
  readonly width: number;
  readonly height: number;
  readonly orientation: Orientation;
  /** Absent for stills. */
  readonly duration?: RationalTime;
  /** The constant grid every decode conforms to. Absent for stills and audio. */
  readonly frameRate?: FrameRate;
  /** Capture rate when it differs from frameRate: 240 for slow motion, 1 for a time-lapse. */
  readonly captureRate?: FrameRate;
  readonly variableFrameRate: boolean;
  readonly hdr: HdrKind;
  readonly speed: SpeedKind;
  /**
   * How many times slower (slow motion) or faster (time-lapse) than real time it plays when every
   * captured frame is shown at frameRate. 1 when normal.
   */
  readonly speedFactor: number;
  /** The file's own timeline is already slowed or sped (Android retimed slow motion, time-lapse). */
  readonly retimedInFile: boolean;
  readonly hasAudio: boolean;
  /**
   * The video codec as probed ('hevc', 'h264', 'prores', 'av1', 'vp9' or another short name). Normalise names it for
   * every video; stills and audio have no video stream (UX2).
   */
  readonly videoCodec?: string;
  /** The first audio stream's codec as probed ('aac', 'pcm_s16le', 'opus' …); named whenever `hasAudio` (UX2). */
  readonly audioCodec?: string;
  /** Bits per colour channel (8, 10, 12); absent only when the probe's pixel format doesn't say (UX2). */
  readonly bitDepth?: number;
  /** Capture time as the device wrote it: ISO 8601, with its offset when known. */
  readonly captureTime?: string;
  /**
   * Where it was shot, as minutes east of UTC (+330 in India, -300 in New York in winter), when the file says (LIB1-OEM):
   * the offset in Apple's creation date, Samsung's `utc_offset`, a photo's EXIF offset. `captureTime` then carries
   * the local time with this offset. Absent when the file names only the instant (an MP4's `creation_time` is UTC
   * with no zone): its local time isn't known.
   */
  readonly captureOffsetMin?: number;
  readonly location?: { readonly latitude: number; readonly longitude: number; readonly altitudeM?: number };
  /**
   * The camera, as the file names it. LIB1-OEM adds Samsung's model number, Apple's lens, and the app that wrote
   * the file when that isn't the phone's own camera (the Sample Cam app writes `app=Sample Cam&device=XC01`).
   */
  readonly device?: {
    readonly make?: string;
    readonly model?: string;
    /** Samsung's model number: 'SM-X000Z'. */
    readonly modelCode?: string;
    /** The lens Apple names: 'iPhone 14 Pro back camera 2.22mm f/2.2'. */
    readonly lens?: string;
    /** The app that wrote the file: 'Sample Cam'. */
    readonly app?: string;
    /** The device that app names, as it names it: 'XC01'. */
    readonly appDevice?: string;
  };
  /**
   * How it was shot, as the phone names the mode (LIB1-OEM): Apple's `com.apple.photos.captureMode` ('Time-lapse').
   * Slow motion and time-lapse by frame rate stay in `speed`.
   */
  readonly captureMode?: string;
  readonly livePhoto?: {
    readonly contentId: string;
    readonly role: 'still' | 'movie';
    readonly pairedBy: 'content-id' | 'name-and-time';
  };
}

export const mediaFactsSchema: z.ZodType<MediaFacts> = z.object({
  version: z.literal(1),
  width: z.int().positive(),
  height: z.int().positive(),
  orientation: z.enum(ORIENTATIONS),
  duration: rationalTimeSchema.optional(),
  frameRate: frameRateSchema.optional(),
  captureRate: frameRateSchema.optional(),
  variableFrameRate: z.boolean(),
  hdr: z.enum(HDR_KINDS),
  speed: z.enum(SPEED_KINDS),
  speedFactor: z.number().positive().max(1000),
  retimedInFile: z.boolean(),
  hasAudio: z.boolean(),
  videoCodec: z.string().min(1).max(32).optional(),
  audioCodec: z.string().min(1).max(32).optional(),
  bitDepth: z.int().min(1).max(16).optional(),
  captureTime: z.string().max(40).optional(),
  captureOffsetMin: z.int().min(CAPTURE_OFFSET_MIN).max(CAPTURE_OFFSET_MAX).optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      altitudeM: z.number().optional(),
    })
    .optional(),
  device: z
    .object({
      make: z.string().max(64).optional(),
      model: z.string().max(64).optional(),
      modelCode: z.string().min(1).max(32).optional(),
      lens: z.string().min(1).max(64).optional(),
      app: z.string().min(1).max(40).optional(),
      appDevice: z.string().min(1).max(40).optional(),
    })
    .optional(),
  captureMode: z.string().min(1).max(40).optional(),
  livePhoto: z
    .object({
      contentId: z.string().min(1).max(64),
      role: z.enum(['still', 'movie']),
      pairedBy: z.enum(['content-id', 'name-and-time']),
    })
    .optional(),
});

export const DERIVED_KINDS = [
  'proxy',
  'thumbnail',
  'filmstrip',
  'waveform',
  'still',
  'conformed',
  // P3: the mix and warped music (audio), subject tracks (render), grade LUTs and looks (vision), speech analyses.
  'mixAudio',
  'warpedMusic',
  'subjectTrack',
  'gradeLut',
  'speechCleanup',
  'lookStats',
  // EAR1: a sound listening analysis (audio's listen cache).
  'soundListen',
] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];

/** '<kind dir>/<hash[0..2]>/<blake3 hex>[.<variant>].v<recipe>.<ext>', relative to the media cache root. */
export const DERIVED_KEY_PATTERN =
  /^(proxies|thumbnails|filmstrips|waveforms|stills|conformed|mix|warped|subjects|grades|speech|looks|listen)\/[0-9a-f]{2}\/[0-9a-f]{64}(\.[a-z0-9-]{1,32})*\.v[1-9][0-9]{0,3}\.(mp4|jpg|json|bin|wav|flac|cube)$/;

export const DERIVED_MIME_TYPES = [
  'video/mp4',
  'image/jpeg',
  'application/json',
  'application/octet-stream',
  'audio/wav',
  'audio/flac',
  /** A grade LUT's .cube. */
  'text/plain',
] as const;

/** A file media made from an original. Never a path: main maps keys inside the cache root only. */
export interface DerivedFileRef {
  readonly kind: DerivedKind;
  readonly key: string;
  readonly bytes: number;
  readonly mimeType: (typeof DERIVED_MIME_TYPES)[number];
  readonly width?: number;
  readonly height?: number;
  readonly duration?: RationalTime;
  readonly frameRate?: FrameRate;
  /** Recipe version: a newer recipe writes a new key. */
  readonly recipe: number;
}

export const derivedFileRefSchema: z.ZodType<DerivedFileRef> = z.object({
  kind: z.enum(DERIVED_KINDS),
  key: z.string().regex(DERIVED_KEY_PATTERN),
  bytes: z.int().nonnegative(),
  mimeType: z.enum(DERIVED_MIME_TYPES),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  duration: rationalTimeSchema.optional(),
  frameRate: frameRateSchema.optional(),
  recipe: z.int().positive(),
});

/** A derived image a card or a grid shows (a thumbnail, a still, a filmstrip). */
export const thumbnailRefSchema = derivedFileRefSchema.refine((ref) => ref.mimeType === 'image/jpeg', {
  message: 'Expected an image',
});
/** A waveform's peaks (JSON or binary), for a beat or audio strip. */
export const waveformRefSchema = derivedFileRefSchema.refine((ref) => ref.kind === 'waveform', {
  message: 'Expected a waveform',
});
