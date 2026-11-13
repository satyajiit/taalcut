// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRate } from '@taalcut/core';
import { expect, it } from 'vitest';
import { isPortraitPreset, presetFor, safeRectFor, videoBitrateKbps } from '../../src/presets/presets.v1';
import { codecCheck } from '../../src/qa/checks/format';
import { h264LevelFlags } from '../../src/presets/h264-level';
import type { StreamFacts } from '../../src/qa/measure/stream-facts';

it('provides native 4K60 masters with proportional safe zones and a high-rate bitrate', () => {
  const portrait = presetFor('master4k');
  const landscape = presetFor('landscape4k');
  expect([portrait.width, portrait.height]).toEqual([2160, 3840]);
  expect([landscape.width, landscape.height]).toEqual([3840, 2160]);
  expect(videoBitrateKbps(portrait, FrameRate.of(60))).toBe(65_000);
  expect(videoBitrateKbps(landscape, FrameRate.of(30))).toBe(45_000);
  expect(isPortraitPreset(portrait)).toBe(true);
  expect(isPortraitPreset(landscape)).toBe(false);
  expect(safeRectFor(['master4k', 'reels'])).toEqual(safeRectFor(['device', 'reels']));
  expect(portrait.safe.x).toBe(presetFor('device').safe.x * 2);
});

it('accepts H.264 level 5.2 for 4K while keeping the 1080p delivery limit', () => {
  const facts: StreamFacts = {
    formatName: 'mp4',
    duration: 1,
    size: 1,
    boxes: [],
    faststart: true,
    video: [
      {
        type: 'video',
        codec: 'h264',
        profile: 'High',
        level: 52,
        width: 2160,
        height: 3840,
        avgFrameRate: '60/1',
        pixFmt: 'yuv420p',
        colorPrimaries: 'bt709',
        colorTransfer: 'bt709',
        colorSpace: 'bt709',
        colorRange: 'tv',
        rotation: 0,
      },
    ],
    audio: [{ type: 'audio', codec: 'aac', profile: 'LC', sampleRate: 48_000, channels: 2, rotation: 0 }],
  };
  expect(codecCheck(facts, presetFor('master4k')).status).toBe('pass');
  expect(codecCheck(facts, presetFor('reels')).status).toBe('fail');
  for (const [width, height] of [
    [2160, 3840],
    [3840, 2160],
    [2160, 2160],
    [2160, 2700],
  ] as const) {
    const underDeclared = { ...facts, video: [{ ...facts.video[0]!, width, height, level: 51 }] };
    expect(codecCheck(underDeclared, presetFor('master4k')).status).toBe('fail');
    expect(
      codecCheck(
        { ...underDeclared, video: [{ ...underDeclared.video[0]!, avgFrameRate: '30/1' }] },
        presetFor('master4k'),
      ).status,
    ).toBe('pass');
  }
  expect(
    codecCheck({ ...facts, video: [{ ...facts.video[0]!, avgFrameRate: 'invalid' }] }, presetFor('master4k'))
      .status,
  ).toBe('fail');
});

it('requests native level 5.2 only for supported high-rate VideoToolbox H.264 outputs', () => {
  expect(h264LevelFlags('h264_videotoolbox', 3840, 2160, FrameRate.of(60))).toEqual(['-level:v', '5.2']);
  for (const [width, height, fps] of [
    [1920, 1080, 60],
    [3840, 2160, 30],
    [7680, 4320, 60],
    [3840, 2160, 120],
  ] as const)
    expect(h264LevelFlags('h264_videotoolbox', width, height, FrameRate.of(fps))).toEqual([]);
  for (const encoder of ['hevc_videotoolbox', 'h264_nvenc', 'libopenh264'])
    expect(h264LevelFlags(encoder, 3840, 2160, FrameRate.of(60))).toEqual([]);
});

it('preserves square and 4:5 composition and keeps safe zones inside every output', () => {
  for (const [id, width, height] of [
    ['square', 1080, 1080],
    ['portrait', 1080, 1350],
    ['square2160', 2160, 2160],
    ['portrait2160', 2160, 2700],
  ] as const) {
    const preset = presetFor(id);
    expect([preset.width, preset.height]).toEqual([width, height]);
    expect(preset.safe.x + preset.safe.width).toBeLessThanOrEqual(width);
    expect(preset.safe.y + preset.safe.height).toBeLessThanOrEqual(height);
    expect(preset.rates).toContainEqual(FrameRate.of(60));
    if (id === 'square' || id === 'portrait') expect(preset.audio.bitrateKbps).toBe(128);
  }
});
