// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Export presets (P2-M9), versioned data. Numbers follow the platform
 * research of 2026-10-13 (research/platform-presets.md): H.264 High through
 * VideoToolbox at 8 Mb/s up to 30 fps and 12 Mb/s above (YouTube's SDR 1080p
 * rows), AAC-LC 48 kHz stereo, −14 LUFS integrated (Taalcut's target; only
 * YouTube's de facto playback reference matches it), and a 179 s ceiling so
 * a file stays a Short, stays recommendable on Reels and fits TikTok's
 * all-creators tier. Safe zones are provisional (safe-zones.v1.json).
 *
 * LNX1-AV1: the platform presets may be exported in HEVC (H.264 stays the default), and two AV1 presets (AV1 Main,
 * 8-bit, in MP4) sit at the end of the list: YouTube Shorts in AV1 (YouTube takes AV1 uploads) and the device copy.
 * They keep the same bitrate ladder; AV1 reaches HEVC's quality under it with fewer bits (media SPEC, "AV1").
 * Whether a codec can be encoded on this machine is the export options' answer (exportOptions, codecs.ts).
 */
import {
  exportPresetIdSchema,
  exportPresetSchema,
  FrameRate,
  type ExportPreset,
  type ExportPresetId,
  type ExportVideoCodec,
  type Platform,
  type Rect,
} from '@taalcut/core';
import { SUPPORTED_RATES } from '../time/frames';
import zones from './safe-zones.v1.json';

type Zone = (typeof zones.platforms)[Platform];

/** QA's loudness band and the mixer's target (qa-gate.md: −14 LUFS ± 1 LU, true peak ≤ −1 dBTP). */
const LOUDNESS = { integratedLufs: -14, toleranceLu: 1, truePeakDbtp: -1 } as const;

/** The largest rect inside every one of `rects`. */
export function intersectRects(rects: readonly Rect[]): Rect {
  const x = Math.max(...rects.map((rect) => rect.x));
  const y = Math.max(...rects.map((rect) => rect.y));
  const right = Math.min(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.min(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

const zoneOf = (platform: Platform): Zone => zones.platforms[platform];
const crossPostSafe = intersectRects([zoneOf('shorts').safe, zoneOf('reels').safe, zoneOf('tiktok').safe]);

/** A 5 % title-safe inset on every side for copies with no platform UI to keep clear of. */
export function titleSafe(width: number, height: number): Rect {
  const x = Math.round(width * 0.05);
  const y = Math.round(height * 0.05);
  return { x, y, width: width - 2 * x, height: height - 2 * y };
}

function preset(
  id: ExportPresetId,
  fields: {
    platform: Platform | null;
    codec: ExportVideoCodec;
    /** LNX1-AV1: the codecs the person may pick, the default first. */
    codecs?: readonly ExportVideoCodec[];
    audioKbps: number;
    minSeconds: number;
    maxSeconds: number;
    /** Output canvas for a copy with symmetric title margins. */
    canvas?: { readonly width: number; readonly height: number };
  },
): ExportPreset {
  const zone = fields.platform ? zoneOf(fields.platform) : null;
  const canvas = fields.canvas;
  const codecs = fields.codecs ? { codecs: [...fields.codecs] } : {};
  if (canvas) {
    const portrait = canvas.width * 16 === canvas.height * 9;
    const safe = titleSafe(canvas.width, canvas.height);
    const uhd = canvas.width * canvas.height > 1920 * 1080;
    return exportPresetSchema.parse({
      id,
      version: 1,
      labelKey: `render.presets.${id}`,
      platform: null,
      width: canvas.width,
      height: canvas.height,
      rates: SUPPORTED_RATES,
      video: {
        codec: fields.codec,
        ...codecs,
        bitrateKbps: uhd ? 45_000 : 8_000,
        bitrateKbpsHighRate: uhd ? 65_000 : 12_000,
      },
      audio: { codec: 'aac', sampleRate: 48_000, channels: 2, bitrateKbps: fields.audioKbps },
      loudness: LOUDNESS,
      duration: { minSeconds: fields.minSeconds, maxSeconds: fields.maxSeconds },
      safe,
      overlays: [],
      safeZoneVersion: 1,
      // A broadcast title-safe convention, not a geometry matched to an app's screenshots.
      safeZoneCheckedOn: null,
      // Lower thirds sit lower on a wide frame than on a phone screen.
      captionAnchorY: portrait ? 0.58 : 0.85,
    });
  }
  return exportPresetSchema.parse({
    id,
    version: 1,
    labelKey: `render.presets.${id}`,
    platform: fields.platform,
    width: 1080,
    height: 1920,
    rates: SUPPORTED_RATES,
    video: {
      codec: fields.codec,
      ...codecs,
      bitrateKbps: 8_000,
      bitrateKbpsHighRate: 12_000,
    },
    audio: { codec: 'aac', sampleRate: 48_000, channels: 2, bitrateKbps: fields.audioKbps },
    loudness: LOUDNESS,
    duration: { minSeconds: fields.minSeconds, maxSeconds: fields.maxSeconds },
    safe: zone ? zone.safe : titleSafe(1080, 1920),
    overlays: zone ? zone.overlays : [],
    safeZoneVersion: zones.version,
    safeZoneCheckedOn: zone ? zones.checkedOn : null,
    // The classic caption style's anchor (captions/style.ts).
    captionAnchorY: 0.58,
  });
}

/** The platform presets' codec choice (LNX1-AV1): H.264, the default every app takes, or HEVC. */
const PLATFORM_CODECS = ['h264', 'hevc'] as const;

function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
}

/** Every preset, in the order the export dialog lists them. */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
  // YouTube recommends 384 kb/s stereo for uploads; 192 kb/s is a speech-safe master (research section 5).
  preset('shorts', {
    platform: 'shorts',
    codec: 'h264',
    codecs: PLATFORM_CODECS,
    audioKbps: 192,
    minSeconds: 1,
    maxSeconds: 179,
  }),
  // The Instagram API's "Audio bitrate: 128kbps" line; 3 s is the API minimum.
  preset('reels', {
    platform: 'reels',
    codec: 'h264',
    codecs: PLATFORM_CODECS,
    audioKbps: 128,
    minSeconds: 3,
    maxSeconds: 179,
  }),
  preset('tiktok', {
    platform: 'tiktok',
    codec: 'h264',
    codecs: PLATFORM_CODECS,
    audioKbps: 192,
    minSeconds: 1,
    maxSeconds: 179,
  }),
  preset('device', { platform: null, codec: 'h264', audioKbps: 192, minSeconds: 1, maxSeconds: 600 }),
  preset('deviceHevc', { platform: null, codec: 'hevc', audioKbps: 192, minSeconds: 1, maxSeconds: 600 }),
  // P3-V2 "and back": the same timeline reframed to 16:9 and 4:3.
  preset('landscape', {
    platform: null,
    codec: 'h264',
    audioKbps: 192,
    minSeconds: 1,
    maxSeconds: 600,
    canvas: { width: 1920, height: 1080 },
  }),
  preset('standard', {
    platform: null,
    codec: 'h264',
    audioKbps: 192,
    minSeconds: 1,
    maxSeconds: 600,
    canvas: { width: 1440, height: 1080 },
  }),
  // LNX1-AV1: only where a hardware AV1 encoder works. The Shorts one keeps Shorts' zones and 179 s ceiling.
  preset('youtubeAv1', { platform: 'shorts', codec: 'av1', audioKbps: 192, minSeconds: 1, maxSeconds: 179 }),
  preset('deviceAv1', { platform: null, codec: 'av1', audioKbps: 192, minSeconds: 1, maxSeconds: 600 }),
  preset('square', {
    platform: null,
    codec: 'h264',
    audioKbps: 128,
    minSeconds: 1,
    maxSeconds: 179,
    canvas: { width: 1080, height: 1080 },
  }),
  preset('portrait', {
    platform: null,
    codec: 'h264',
    audioKbps: 128,
    minSeconds: 1,
    maxSeconds: 179,
    canvas: { width: 1080, height: 1350 },
  }),
  preset('square2160', {
    platform: null,
    codec: 'h264',
    audioKbps: 384,
    minSeconds: 1,
    maxSeconds: 179,
    canvas: { width: 2160, height: 2160 },
  }),
  preset('portrait2160', {
    platform: null,
    codec: 'h264',
    audioKbps: 384,
    minSeconds: 1,
    maxSeconds: 179,
    canvas: { width: 2160, height: 2700 },
  }),
  preset('master4k', {
    platform: null,
    codec: 'h264',
    codecs: PLATFORM_CODECS,
    audioKbps: 384,
    minSeconds: 1,
    maxSeconds: 600,
    canvas: { width: 2160, height: 3840 },
  }),
  preset('landscape4k', {
    platform: null,
    codec: 'h264',
    codecs: PLATFORM_CODECS,
    audioKbps: 384,
    minSeconds: 1,
    maxSeconds: 600,
    canvas: { width: 3840, height: 2160 },
  }),
];

export const DEFAULT_PRESET_ID: ExportPresetId = 'device';

/** Wider than this is the 16:9 preset; landscape up to it is the 4:3 one (between 4:3's 1.33 and 16:9's 1.78). */
const WIDE_ASPECT = 1.55;

/**
 * The preset an export takes while the person has chosen none (BRK1): the timeline's shape, which assembly takes from
 * the template. A landscape reel's template exports landscape, 16:9 or 4:3; a portrait or square one, the vertical
 * default. A vertical preset for a landscape template is the person's choice.
 */
export function defaultPresetFor(canvas: {
  readonly width: number;
  readonly height: number;
}): ExportPresetId {
  if (canvas.width <= canvas.height) return DEFAULT_PRESET_ID;
  return canvas.width / canvas.height >= WIDE_ASPECT ? 'landscape' : 'standard';
}

/** EXPORT_PRESETS' ids as a tuple (every id core names, now that the landscape canvases are built). */
export const BUILT_PRESET_IDS = [
  'shorts',
  'reels',
  'tiktok',
  'device',
  'deviceHevc',
  'landscape',
  'standard',
  'youtubeAv1',
  'deviceAv1',
  'square',
  'portrait',
  'square2160',
  'portrait2160',
  'master4k',
  'landscape4k',
] as const satisfies readonly ExportPresetId[];

/** Every preset this build renders. */
export const builtPresetIdSchema = exportPresetIdSchema.extract(BUILT_PRESET_IDS);

/**
 * The presets the agent's tools offer: what this build renders on any machine, so the model never picks one it can't
 * have. The AV1 presets (LNX1-AV1) need the machine's hardware AV1 encoder, which the tools can't know (they run in
 * main, without media); the person picks them in the export dialog, and the agent's exports follow that choice. The
 * recorded sessions replay this catalogue (apps/gate-demo fixtures), including the supported square and 4K sizes.
 */
export const AGENT_PRESET_IDS = [
  'shorts',
  'reels',
  'tiktok',
  'device',
  'deviceHevc',
  'landscape',
  'standard',
  'square',
  'portrait',
  'square2160',
  'portrait2160',
  'master4k',
  'landscape4k',
] as const satisfies readonly (typeof BUILT_PRESET_IDS)[number][];
export const agentPresetIdSchema = exportPresetIdSchema.extract(AGENT_PRESET_IDS);

/**
 * The presets drawn on the timeline's own portrait canvas: a frame capture can overlay their platform UI. The AV1
 * presets draw what `shorts` and `device` draw (the same canvas, safe rect and overlays), so they aren't listed: the
 * capture tool's input stays the one the recorded sessions were made with.
 */
export const OVERLAY_PRESET_IDS = [
  'shorts',
  'reels',
  'tiktok',
  'device',
  'deviceHevc',
] as const satisfies readonly ExportPresetId[];
export const overlayPresetIdSchema = exportPresetIdSchema.extract(OVERLAY_PRESET_IDS);

/** Where each provisional geometry came from, for the SPEC and the safe-zone layer's tooltip. */
export function safeZoneProvenance(platform: Platform): { provenance: string; source: string } {
  const zone = zoneOf(platform);
  return { provenance: zone.provenance, source: zone.source };
}

/** Whether this build renders the preset (core names more than the engine has yet). */
export function hasPreset(id: ExportPresetId): boolean {
  return EXPORT_PRESETS.some((candidate) => candidate.id === id);
}

export function presetFor(id: ExportPresetId): ExportPreset {
  const found = EXPORT_PRESETS.find((candidate) => candidate.id === id);
  if (!found) throw new RangeError(`No export preset '${id}'`);
  return found;
}

/** Every codec the preset can be exported in, the default first. */
export function presetCodecs(presetValue: ExportPreset): readonly ExportVideoCodec[] {
  return presetValue.video.codecs ?? [presetValue.video.codec];
}

/**
 * The preset as the export writes it in `codec` (one of its codecs; absent: its default): everything after the
 * request reads `video.codec` (finishing, QA's codec check). Undefined for a codec the preset doesn't offer.
 */
export function presetInCodec(
  presetValue: ExportPreset,
  codec: ExportVideoCodec | undefined,
): ExportPreset | undefined {
  if (codec === undefined || codec === presetValue.video.codec) return presetValue;
  if (!presetCodecs(presetValue).includes(codec)) return undefined;
  return { ...presetValue, video: { ...presetValue.video, codec } };
}

/** The rect text must stay inside for every preset named (one preset: its own safe rect). Portrait presets only. */
export function safeRectFor(presetIds: readonly ExportPresetId[]): Rect {
  const portrait = presetIds.map(presetFor).filter(isPortraitPreset);
  if (portrait.length === 0) return crossPostSafe;
  // Caption authoring uses the 1080-wide reference canvas even for a 4K output.
  return intersectRects(portrait.map((value) => scaleRect(value.safe, 1080 / value.width)));
}

/** Whether the preset's canvas is the timeline's own (portrait) or one it is reframed into. */
export function isPortraitPreset(presetValue: ExportPreset): boolean {
  return presetValue.width * 16 === presetValue.height * 9;
}

/** The preset's video bitrate at a rate: the high-rate figure above 30 fps. */
export function videoBitrateKbps(presetValue: ExportPreset, rate: FrameRate): number {
  return FrameRate.toNumber(rate) > 30.5
    ? presetValue.video.bitrateKbpsHighRate
    : presetValue.video.bitrateKbps;
}

/** Whether a timeline of `durationFrames` at `rate` fits the preset; the reason key when it doesn't. */
export function presetAvailability(
  presetValue: ExportPreset,
  rate: FrameRate,
  durationFrames: number,
): { available: true } | { available: false; reasonKey: string } {
  if (!presetValue.rates.some((allowed) => FrameRate.equals(allowed, rate)))
    return { available: false, reasonKey: 'render.unavailable.frameRate' };
  const seconds = (durationFrames * rate.den) / rate.num;
  if (seconds > presetValue.duration.maxSeconds)
    return { available: false, reasonKey: 'render.unavailable.tooLong' };
  if (seconds < presetValue.duration.minSeconds)
    return { available: false, reasonKey: 'render.unavailable.tooShort' };
  return { available: true };
}
