// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render fake's export presets: @taalcut/render's EXPORT_PRESETS (presets.v1.ts with safe-zones.v1.json),
 * field for field and in the export dialog's order, so renderer dev and e2e judge "fits the preset" and size an
 * export as the engine does. The renderer can't import render, so the table is copied here;
 * scripts/fakes/fake-parity.test.ts deep-equals it with the engine's.
 */
import type { ExportPreset, ExportPresetId, ExportVideoCodec, Rect } from '@taalcut/core';

/** render's SUPPORTED_RATES. */
const RATES = [
  { num: 24, den: 1 },
  { num: 30, den: 1 },
  { num: 60, den: 1 },
  { num: 30000, den: 1001 },
  { num: 60000, den: 1001 },
];
const LOUDNESS = { integratedLufs: -14, toleranceLu: 1, truePeakDbtp: -1 };
/** H.264 (or HEVC) through VideoToolbox: 8 Mb/s up to 30 fps, 12 Mb/s above. */
const VIDEO_KBPS = { bitrateKbps: 8_000, bitrateKbpsHighRate: 12_000 };
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

type Overlays = ExportPreset['overlays'];

/** safe-zones.v1.json, provisional until the device lab matches them (safeZoneCheckedOn null). */
const ZONES: Readonly<Record<'shorts' | 'reels' | 'tiktok', { safe: Rect; overlays: Overlays }>> = {
  shorts: {
    safe: rect(48, 288, 840, 960),
    overlays: [
      { kind: 'topBar', rect: rect(0, 0, 1080, 288) },
      { kind: 'actionRail', rect: rect(888, 0, 192, 1920) },
      { kind: 'bottomInfo', rect: rect(0, 1248, 1080, 672) },
    ],
  },
  reels: {
    safe: rect(65, 269, 950, 979),
    overlays: [
      { kind: 'topBar', rect: rect(0, 0, 1080, 269) },
      { kind: 'actionRail', rect: rect(1015, 0, 65, 1920) },
      { kind: 'bottomInfo', rect: rect(0, 1248, 1080, 672) },
    ],
  },
  tiktok: {
    safe: rect(120, 240, 660, 1020),
    overlays: [
      { kind: 'topBar', rect: rect(0, 0, 1080, 240) },
      { kind: 'actionRail', rect: rect(780, 840, 300, 1080) },
      { kind: 'bottomInfo', rect: rect(0, 1260, 1080, 660) },
    ],
  },
};
/** Device exports use symmetric 5 % title margins without platform UI. */
const DEVICE_SAFE = rect(54, 96, 972, 1728);

interface Fields {
  readonly platform: 'shorts' | 'reels' | 'tiktok' | null;
  readonly codec?: ExportVideoCodec;
  /** LNX1-AV1: the codecs the person may pick, the default first. */
  readonly codecs?: readonly ExportVideoCodec[];
  readonly audioKbps: number;
  readonly minSeconds: number;
  readonly maxSeconds: number;
}

function preset(id: ExportPresetId, fields: Fields): ExportPreset {
  const zone = fields.platform ? ZONES[fields.platform] : null;
  return {
    id,
    version: 1,
    labelKey: `render.presets.${id}`,
    platform: fields.platform,
    width: 1080,
    height: 1920,
    rates: RATES,
    video: {
      codec: fields.codec ?? 'h264',
      ...(fields.codecs ? { codecs: [...fields.codecs] } : {}),
      ...VIDEO_KBPS,
    },
    audio: { codec: 'aac', sampleRate: 48_000, channels: 2, bitrateKbps: fields.audioKbps },
    loudness: LOUDNESS,
    duration: { minSeconds: fields.minSeconds, maxSeconds: fields.maxSeconds },
    safe: zone ? zone.safe : DEVICE_SAFE,
    overlays: zone ? zone.overlays : [],
    safeZoneVersion: 1,
    safeZoneCheckedOn: null,
    captionAnchorY: 0.58,
  };
}

/** P3-V2's landscape canvases: a 5 % title-safe inset on every side, no platform UI, captions low. */
function canvasPreset(
  id: ExportPresetId,
  width: number,
  height = 1080,
  maxSeconds = 600,
  codecs?: readonly ExportVideoCodec[],
): ExportPreset {
  const portrait = width * 16 === height * 9;
  const uhd = width * height > 1920 * 1080;
  const x = Math.round(width * 0.05);
  const y = Math.round(height * 0.05);
  const base = preset(id, {
    platform: null,
    audioKbps: uhd ? 384 : id === 'square' || id === 'portrait' ? 128 : 192,
    minSeconds: 1,
    maxSeconds,
    ...(codecs ? { codecs } : {}),
  });
  return {
    ...base,
    width,
    height,
    video: { ...base.video, bitrateKbps: uhd ? 45_000 : 8_000, bitrateKbpsHighRate: uhd ? 65_000 : 12_000 },
    safe: rect(x, y, width - 2 * x, height - 2 * y),
    captionAnchorY: portrait ? 0.58 : 0.85,
  };
}

/** The platform presets' codec choice (LNX1-AV1): H.264 the default, HEVC where the machine encodes it. */
const PLATFORM_CODECS = ['h264', 'hevc'] as const;

/** Every preset, in the order the export dialog lists them (179 s keeps a file a Short and a recommendable Reel). */
export const PRESETS: readonly ExportPreset[] = [
  preset('shorts', {
    platform: 'shorts',
    codecs: PLATFORM_CODECS,
    audioKbps: 192,
    minSeconds: 1,
    maxSeconds: 179,
  }),
  preset('reels', {
    platform: 'reels',
    codecs: PLATFORM_CODECS,
    audioKbps: 128,
    minSeconds: 3,
    maxSeconds: 179,
  }),
  preset('tiktok', {
    platform: 'tiktok',
    codecs: PLATFORM_CODECS,
    audioKbps: 192,
    minSeconds: 1,
    maxSeconds: 179,
  }),
  preset('device', { platform: null, audioKbps: 192, minSeconds: 1, maxSeconds: 600 }),
  preset('deviceHevc', { platform: null, codec: 'hevc', audioKbps: 192, minSeconds: 1, maxSeconds: 600 }),
  canvasPreset('landscape', 1920),
  canvasPreset('standard', 1440),
  // LNX1-AV1: only where the machine encodes AV1 in hardware (the export options say which).
  preset('youtubeAv1', { platform: 'shorts', codec: 'av1', audioKbps: 192, minSeconds: 1, maxSeconds: 179 }),
  preset('deviceAv1', { platform: null, codec: 'av1', audioKbps: 192, minSeconds: 1, maxSeconds: 600 }),
  canvasPreset('square', 1080, 1080, 179),
  canvasPreset('portrait', 1080, 1350, 179),
  canvasPreset('square2160', 2160, 2160, 179),
  canvasPreset('portrait2160', 2160, 2700, 179),
  canvasPreset('master4k', 2160, 3840, 600, PLATFORM_CODECS),
  canvasPreset('landscape4k', 3840, 2160, 600, PLATFORM_CODECS),
];
