// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Planned visuals and probe streams for conform tests, without planning a whole timeline. */
import { FrameRate, newId, RationalTime, type AssetId } from '@taalcut/core';
import type { VideoStreamInfo } from '@taalcut/media';
import type { PlannedVisual } from '../../src/plan/types';

/** A video visual of `frames` frames at 30 fps, real time, in-point zero; override what a test needs. */
export function plannedVisual(frames: number, overrides: Partial<PlannedVisual> = {}): PlannedVisual {
  const rate = FrameRate.of(30);
  return {
    id: newId<'TimelineItem'>(),
    kind: 'video',
    assetId: newId<'Asset'>() as AssetId,
    cut: { start: 0, end: frames },
    visible: { start: 0, end: frames },
    sourceIn: RationalTime.of(0, rate),
    sourceAtCut: RationalTime.of(0, rate),
    speed: null,
    meanSpeed: 1,
    fit: 'cover',
    enabled: true,
    slotId: null,
    beat: null,
    audio: { gainDb: 0, muted: false },
    reframe: null,
    stillMotion: null,
    ...overrides,
  };
}

/** An iPhone portrait clip's probe: coded landscape with a 90° display matrix. */
export function phoneStream(overrides: Partial<VideoStreamInfo> = {}): VideoStreamInfo {
  return {
    kind: 'video',
    index: 0,
    codec: 'hevc',
    width: 1920,
    height: 1080,
    displayWidth: 1080,
    displayHeight: 1920,
    rotation: 90,
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    colour: {},
    isHdr: false,
    hdrFormats: [],
    vfrHint: false,
    tags: {},
    ...overrides,
  } as VideoStreamInfo;
}
