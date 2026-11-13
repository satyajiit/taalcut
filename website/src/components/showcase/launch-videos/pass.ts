// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The launch showcase's one arrival, as a clock: the script and the look approved, then production designing the
 * video scene by scene, the voiceover, the review, and the video ready to play, under five seconds (DESIGN.md › Motion
 * on the site). `passAt` says what the window shows at a moment, so a replay is a clock and a test can read any frame.
 * Research and the script are done before it starts: the brief, the sources and the script are on screen throughout.
 */

import type { TaskRole, TaskStatus } from './story';

/** When each part happens, in ms from the start. */
export const PASS = {
  /** The approval is pressed. */
  approve: 420,
  /** Design starts; each scene takes `designGap`. */
  design: 620,
  designGap: 330,
} as const;

/** When the voiceover starts, the review starts, and the video is ready, for a script of `scenes` scenes. */
export function passEnds(scenes: number) {
  const voice = PASS.design + PASS.designGap * scenes;
  const review = voice + 380;
  return { voice, review, end: review + 380 } as const;
}

export interface PassFrame {
  /** The script and the look are approved. */
  readonly approved: boolean;
  /** The scene production is designing now, or null. */
  readonly designing: number | null;
  /** How many scenes production has designed. */
  readonly designed: number;
  readonly task: Readonly<Record<TaskRole, TaskStatus>>;
  readonly ready: boolean;
}

/** The pass at `at` ms for a script of `scenes` scenes: from its end on, everything is finished. */
export function passAt(at: number, scenes: number): PassFrame {
  const { voice, review, end } = passEnds(scenes);
  const status = (start: number, stop: number): TaskStatus => (at >= stop ? 'completed' : at >= start ? 'running' : 'queued');
  const designed = at < PASS.design ? 0 : Math.min(scenes, Math.floor((at - PASS.design) / PASS.designGap));
  return {
    approved: at >= PASS.approve,
    designing: at >= PASS.design && designed < scenes ? designed : null,
    designed,
    task: {
      researcher: 'completed',
      writer: 'completed',
      designer: status(PASS.design, voice),
      voice: status(voice, review),
      reviewer: status(review, end),
    },
    ready: at >= end,
  };
}

/** Every moment the pass changes, in order, from `from` ms: the showcase sets a timer for each. */
export function passTimes(scenes: number, from = 0): number[] {
  const { voice, review, end } = passEnds(scenes);
  const times = [PASS.approve, ...Array.from({ length: scenes + 1 }, (_, i) => PASS.design + i * PASS.designGap), voice, review, end];
  return [...new Set(times)].filter((t) => t >= from).sort((a, b) => a - b);
}
