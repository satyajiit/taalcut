// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Render's document parts (P2-M5, P2-M10, G5): presets, captions and the music choice. */
import { describe, expect, it } from 'vitest';
import {
  captionStyleSchema,
  captionTrackSchema,
  exportPresetSchema,
  FrameRates,
  musicChoiceSchema,
  newId,
  platformSoundStepsSchema,
  PLATFORMS,
  REFERENCE_PLATFORMS,
} from '@taalcut/core';
import { at, captionTrack, json } from './helpers/documents';

const reels = {
  id: 'reels',
  version: 1,
  labelKey: 'render.presets.reels',
  platform: 'reels',
  width: 1080,
  height: 1920,
  rates: [FrameRates.fps30, FrameRates.fps29_97],
  video: { codec: 'h264', bitrateKbps: 8000, bitrateKbpsHighRate: 12000 },
  audio: { codec: 'aac', sampleRate: 48_000, channels: 2, bitrateKbps: 192 },
  loudness: { integratedLufs: -14, toleranceLu: 1, truePeakDbtp: -1 },
  duration: { minSeconds: 3, maxSeconds: 180 },
  safe: { x: 60, y: 220, width: 900, height: 1300 },
  overlays: [{ kind: 'actionRail', rect: { x: 960, y: 900, width: 120, height: 600 } }],
  safeZoneVersion: 1,
  safeZoneCheckedOn: '2026-12-01',
  captionAnchorY: 0.58,
};

describe('render parts', () => {
  it('a preset round-trips; the canvas is one of CANVASES', () => {
    expect(exportPresetSchema.parse(json(reels))).toEqual(reels);
    expect(exportPresetSchema.safeParse({ ...reels, width: 720 }).success).toBe(false);
    expect(
      exportPresetSchema.safeParse({ ...reels, id: 'landscape', width: 1920, height: 1080 }).success,
    ).toBe(true);
    expect(
      exportPresetSchema.safeParse({ ...reels, id: 'standard', width: 1440, height: 1080 }).success,
    ).toBe(true);
    expect(exportPresetSchema.safeParse({ ...reels, width: 1920, height: 1920 }).success).toBe(false);
    expect(exportPresetSchema.safeParse({ ...reels, captionAnchorY: 1.2 }).success).toBe(false);
    expect(exportPresetSchema.safeParse({ ...reels, safeZoneCheckedOn: 'soon' }).success).toBe(false);
  });

  it('every export platform is also a reference platform', () => {
    for (const platform of PLATFORMS) expect(REFERENCE_PLATFORMS).toContain(platform);
  });

  it('a caption track round-trips; styles are bounded', () => {
    const track = captionTrack([[0, 30]]);
    expect(captionTrackSchema.parse(json(track))).toEqual(track);
    expect(captionStyleSchema.safeParse({ ...track.style, weight: 650 }).success).toBe(false);
    expect(captionStyleSchema.safeParse({ ...track.style, textColor: 'white' }).success).toBe(false);
    expect(captionTrackSchema.safeParse({ ...track, language: 'English' }).success).toBe(false);
  });

  it('music choices are one of the three paths', () => {
    const own = { path: 'ownTrack', assetId: newId<'Asset'>(), offset: at(0), gainDb: -3 };
    expect(musicChoiceSchema.parse(json(own))).toEqual(own);
    expect(musicChoiceSchema.parse({ path: 'platformSound' })).toEqual({ path: 'platformSound' });
    expect(musicChoiceSchema.safeParse({ path: 'generated' }).success).toBe(false);
    expect(musicChoiceSchema.safeParse({ path: 'referenceAudio', templateId: 'x', gainDb: 0 }).success).toBe(
      false,
    );
    const steps = {
      referenceUrl: null,
      soundLabel: 'Original audio',
      steps: [{ platform: 'reels', stepKeys: ['music.platformSound.steps.reels.open'] }],
    };
    expect(platformSoundStepsSchema.parse(steps)).toEqual(steps);
  });
});
