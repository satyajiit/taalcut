// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What Kaatu is asked to be (a part), and what follows from it before anything plays: its still frame and breath. */
import type { Clip } from './kaatu-acts';
import type { KaatuFrame } from './kaatu-frames';
import { moodScript, type KaatuMood, type KaatuToward } from './kaatu-moods';
import type { KaatuMove } from './kaatu-moves';
import { POSE_REPEATS, POSES, type KaatuPose } from './kaatu-poses';

/** What Kaatu is asked to be: a pose, or a mood, and whether motion is reduced. */
export interface KaatuPart {
  readonly pose?: KaatuPose;
  readonly mood: KaatuMood;
  readonly toward: KaatuToward;
  readonly reduce: boolean;
}

/** Where the engine's choices land: the page (use-kaatu.ts), or a test's record. */
export interface KaatuView {
  /** Show a frame; `fade` crossfades it in (reduced motion). */
  show(frame: KaatuFrame, fade: boolean): void;
  move(move: KaatuMove): void;
  breath(state: KaatuBreath): void;
  note(side: 'left' | 'right'): void;
}

export type KaatuBreath = 'awake' | 'asleep';

/** The frame a part shows without JavaScript and under reduced motion. */
export function stillOf(part: Pick<KaatuPart, 'pose' | 'mood' | 'toward'>): KaatuFrame {
  return part.pose ? POSES[part.pose].frame : moodScript(part.mood, part.toward).still;
}

/** The breath a part starts with. */
export function breathOf(part: Pick<KaatuPart, 'pose' | 'mood' | 'toward'>): KaatuBreath {
  if (part.pose) return POSES[part.pose].asleep ? 'asleep' : 'awake';
  return moodScript(part.mood, part.toward).breath;
}

export function keyOf(part: KaatuPart): string {
  return part.pose ? `pose:${part.pose}` : `mood:${part.mood}:${part.toward}`;
}

/** The opening a part plays once, the first time it is on screen. */
export function openingOf(part: KaatuPart): { readonly clip: Clip; readonly move?: KaatuMove } | null {
  if (part.pose) {
    const act = POSES[part.pose].act;
    return act ? { clip: Array.from({ length: POSE_REPEATS }, () => act).flat() } : null;
  }
  const script = moodScript(part.mood, part.toward);
  return script.opening ? { clip: script.opening, ...(script.move ? { move: script.move } : {}) } : null;
}
