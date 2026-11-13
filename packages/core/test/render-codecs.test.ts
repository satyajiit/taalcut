// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-AV1's contract: the AV1 preset ids, AV1 as an export codec, a preset's codec choices, the codec an export
 * request and the project's export settings name, and each preset's codecs on this machine in the export options.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_PRESET_IDS,
  EXPORT_VIDEO_CODECS,
  exportOptionsSchema,
  exportPresetSchema,
  exportRequestSchema,
  FrameRates,
  newId,
  RENDER_COMMANDS,
  renderCommandPayloads,
} from '@taalcut/core';
import { json } from './helpers/documents';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();

const shorts = {
  id: 'shorts',
  version: 1,
  labelKey: 'render.presets.shorts',
  platform: 'shorts',
  width: 1080,
  height: 1920,
  rates: [FrameRates.fps30],
  video: { codec: 'h264', codecs: ['h264', 'hevc'], bitrateKbps: 8000, bitrateKbpsHighRate: 12000 },
  audio: { codec: 'aac', sampleRate: 48_000, channels: 2, bitrateKbps: 192 },
  loudness: { integratedLufs: -14, toleranceLu: 1, truePeakDbtp: -1 },
  duration: { minSeconds: 1, maxSeconds: 179 },
  safe: { x: 48, y: 288, width: 840, height: 960 },
  overlays: [],
  safeZoneVersion: 1,
  safeZoneCheckedOn: null,
  captionAnchorY: 0.58,
};

describe('LNX1-AV1 contract', () => {
  it('names the AV1 presets and AV1 as a codec', () => {
    expect(EXPORT_PRESET_IDS).toEqual(expect.arrayContaining(['youtubeAv1', 'deviceAv1']));
    expect(EXPORT_VIDEO_CODECS).toEqual(['h264', 'hevc', 'av1']);
  });

  it('a preset has a default codec and, optionally, the codecs the person may pick', () => {
    expect(exportPresetSchema.parse(json(shorts))).toEqual(shorts);
    const av1 = { ...shorts, id: 'youtubeAv1', video: { ...shorts.video, codec: 'av1', codecs: undefined } };
    expect(exportPresetSchema.parse(json(av1)).video.codec).toBe('av1');
    expect(exportPresetSchema.safeParse({ ...shorts, video: { ...shorts.video, codecs: [] } }).success).toBe(
      false,
    );
    expect(
      exportPresetSchema.safeParse({ ...shorts, video: { ...shorts.video, codec: 'vp9' } }).success,
    ).toBe(false);
  });

  it('an export request and the project’s settings may name a codec; absent is the preset’s default', () => {
    const request = { projectId, timelineId, presetId: 'reels', captions: { burnIn: false, sidecars: [] } };
    expect(exportRequestSchema.parse(request).codec).toBeUndefined();
    expect(exportRequestSchema.parse({ ...request, codec: 'hevc' }).codec).toBe('hevc');
    expect(exportRequestSchema.safeParse({ ...request, codec: 'prores' }).success).toBe(false);
    const settings = renderCommandPayloads[RENDER_COMMANDS.setExportPreset];
    expect(settings.parse({ projectId, presetId: 'tiktok', codec: 'hevc' })).toEqual({
      projectId,
      presetId: 'tiktok',
      codec: 'hevc',
    });
  });

  it('export options carry each preset’s codecs on this machine, with why one can’t be used', () => {
    const entry = {
      preset: {
        ...shorts,
        id: 'youtubeAv1',
        video: { codec: 'av1', bitrateKbps: 8000, bitrateKbpsHighRate: 12000 },
      },
      available: false,
      reasonKey: 'render.unavailable.noAv1Encoder',
      estimate: { bytes: 1, renderMs: 1 },
      codecs: [{ codec: 'av1', available: false, reasonKey: 'render.unavailable.noAv1Encoder' }],
    };
    const options = {
      projectId,
      timelineId,
      timelineRevision: 1,
      rate: FrameRates.fps30,
      durationFrames: 300,
      presets: [
        entry,
        { ...entry, preset: shorts, available: true, reasonKey: undefined, codecs: undefined },
      ],
      defaultPresetId: 'shorts',
      music: {
        current: { path: 'platformSound' },
        referenceAudioAvailable: false,
        referenceAudioAcknowledged: false,
        platformSound: null,
      },
      captions: { available: false, enabled: false, language: null },
    };
    const parsed = exportOptionsSchema.parse(json(options));
    expect(parsed.presets[0]?.codecs).toEqual(entry.codecs);
    expect(parsed.presets[1]?.codecs).toBeUndefined();
  });
});
