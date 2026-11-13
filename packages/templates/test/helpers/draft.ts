// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A breakdown draft of a 4-second reel at 30 fps: hard cuts at 30 and 90 that
 * both methods found, a disputed hard cut at 45 the rule keeps, a disputed
 * dissolve at 70 the rule drops, beats every 15 frames, one overlay.
 */
import { FrameRate, FrameRates, newId, RationalTime } from '@taalcut/core';
import { breakdownDraftSchema, type BreakdownDraft } from '../../src/index';
import { SHA } from './fixtures';

const fps30 = FrameRates.fps30;
const at = (value: number) => RationalTime.of(value, fps30);

export function draftFixture(): BreakdownDraft {
  const beatRate = FrameRate.of(50);
  return breakdownDraftSchema.parse({
    breakdownId: newId(),
    pipelineVersion: '1',
    configVersion: 'breakdown.v1',
    fingerprint: SHA,
    analysedAt: 1,
    reference: {
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/abc',
      sound: { title: 'Original audio', artist: null },
      source: { duration: at(120), rate: fps30, width: 1080, height: 1920 },
      crop: null,
    },
    canvas: { width: 1080, height: 1920, rate: fps30 },
    duration: at(120),
    cuts: [
      { frame: 30, method: 'both', score: 40, distance: 0.7, transition: null },
      { frame: 90, method: 'both', score: 55, distance: 0.8, transition: null },
    ],
    disputes: [
      {
        frame: 45,
        method: 'scdet',
        score: 30,
        distance: 0.12,
        transition: null,
        ramp: null,
        ruleKeeps: true,
        before: 'frames/frame-000044.jpg',
        after: 'frames/frame-000045.jpg',
      },
      {
        frame: 70,
        method: 'embedding',
        score: null,
        distance: 0.3,
        transition: { kind: 'dissolve', before: 5, after: 6, confidence: 0.85 },
        ramp: { start: 65, end: 75 },
        ruleKeeps: false,
        before: 'frames/frame-000069.jpg',
        after: 'frames/frame-000070.jpg',
      },
    ],
    beatMap: {
      rate: beatRate,
      beats: [0, 25, 50, 75, 100, 125, 150, 175].map((value) => RationalTime.of(value, beatRate)),
      downbeats: [0, 4],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    },
    text: [
      {
        id: newId(),
        text: 'Day 1 in Goa',
        role: 'title',
        start: at(32),
        duration: at(20),
        slotId: null,
        box: { x: 0.1, y: 0.1, width: 0.8, height: 0.08 },
        appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
        styleKey: 'title',
        reveal: 'none',
        language: 'en',
        confidence: 0.9,
      },
    ],
    audio: {
      kind: 'music',
      loudnessLufs: -14,
      sound: { title: 'Original audio', artist: null },
      speech: null,
      waveform: null,
    },
    language: 'en',
    ramps: [],
    slotFrames: [
      {
        start: 0,
        end: 30,
        frames: ['frames/frame-000000.jpg', 'frames/frame-000014.jpg', 'frames/frame-000029.jpg'],
      },
      { start: 30, end: 45, frames: ['frames/frame-000030.jpg'] },
      { start: 45, end: 90, frames: ['frames/frame-000067.jpg'] },
      { start: 90, end: 120, frames: ['frames/frame-000104.jpg'] },
    ],
    contactSheet: {
      path: 'contact-sheet.jpg',
      bytes: 1000,
      mediaType: 'image/jpeg',
      columns: 2,
      rows: 2,
      tile: { width: 102, height: 180 },
      frames: [14, 37, 67, 104],
    },
    warnings: [],
  });
}
