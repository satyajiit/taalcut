// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-DOCKCHAT: the reel of reel-run-slots.ts as a template, the way its run left it: every slot approved, no tempo
 * found (beats, but no beats a minute), and two things about the reel still to check (speech that may be misheard,
 * no sound credit). Unlisted, like the review's reels: read in a chat and not saved, so no list shows it.
 */
import type { Template } from '@taalcut/core';
import { REEL_RUN_SLOTS } from './reel-run-slots';
import { buildTemplate } from './template-data';
import type { TemplatePlan } from './template-plans';

const TRACKER = { num: 50, den: 1 } as const;

/** One "beat" a frame, so each slot keeps its own length (47, 37, 68, then 6 to 9 frames a cut). */
export const REEL_RUN: TemplatePlan = {
  n: 8,
  name: 'Travel days in quick cuts',
  platform: 'reels',
  bpm: 128,
  beatFrames: 1,
  scene: 2,
  language: 'en',
  slots: REEL_RUN_SLOTS.map(({ frames, role, text, shotType, motion, energy }) => ({
    beats: frames,
    role,
    text,
    shotType,
    motion,
    energy,
  })),
  overlays: [],
};

export function reelRunTemplate(): Template {
  const built = buildTemplate(REEL_RUN);
  const seconds = built.duration.value / 30;
  // The tracker heard a beat about every 0.47 s and no steady tempo.
  const beats = Array.from({ length: Math.floor(seconds / 0.47) }, (_, i) => ({
    value: Math.round(i * 0.47 * 50),
    rate: TRACKER,
  }));
  return {
    ...built,
    slots: built.slots.map((slot) => ({ ...slot, approved: true, beatAnchor: null, transitionIn: null })),
    beatMap: built.beatMap
      ? {
          ...built.beatMap,
          beats,
          downbeats: Array.from({ length: Math.ceil(beats.length / 4) }, (_, i) => i * 4),
          bpm: null,
          confidence: 1,
        }
      : null,
    doubts: [{ reason: 'speechMaybeHallucinated' }, { reason: 'soundCreditMissing' }],
    audio: { ...built.audio, kind: 'mixed', sound: null },
    pacing: { ...built.pacing, cutsOnBeat: null },
  };
}
