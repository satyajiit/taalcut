// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the editor's new edits as the renderer sends them, each one core's command from 'ui' (EDITOR_COMMANDS,
 * AUDIO_EDIT_COMMANDS) through the editor's edits, so a refusal lands on the line under the transport and ⌘Z undoes
 * it. Pure helpers: what the clip has now (its speed, transition, sound, colour) for the inspector's controls.
 */
import {
  AUDIO_EDIT_COMMANDS,
  EDITOR_COMMANDS,
  type DrawnTransitionKind,
  type FrameRate,
  type GradePatch,
  type Result,
  type TimelineItemId,
  type TransitionItem,
} from '@taalcut/core';
import { atRate, type ClipView, type TimelineModel } from './model';
import type { Edits } from './use-edits';

/** The speeds the inspector offers; 1 is normal. */
export const SPEED_CHOICES = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;
/** Fades the inspector offers, in seconds; 0 is none. */
export const FADE_CHOICES = [0, 0.25, 0.5, 1, 2] as const;
/** The transitions the inspector offers, plus `cut` (none). */
export const TRANSITION_CHOICES = ['cut', 'dissolve', 'fade', 'flash', 'whip', 'zoom', 'slide'] as const;
export type TransitionChoice = (typeof TRANSITION_CHOICES)[number];

const seconds = (value: number, rate: FrameRate) => atRate((value * rate.num) / rate.den, rate);

export interface EditorOps {
  split(clipId: TimelineItemId, frame: number): Promise<Result<unknown>>;
  remove(clipId: TimelineItemId): Promise<Result<unknown>>;
  speed(clipId: TimelineItemId, speed: number): Promise<Result<unknown>>;
  transition(clipId: TimelineItemId, kind: TransitionChoice): Promise<Result<unknown>>;
  grade(target: { clipIds: TimelineItemId[] } | 'video', patch: GradePatch | null): Promise<Result<unknown>>;
  volume(
    clipId: TimelineItemId,
    change: { gainDb?: number; muted?: boolean; fadeInSeconds?: number; fadeOutSeconds?: number },
  ): Promise<Result<unknown>>;
}

export function editorOps(edits: Edits, rate: FrameRate): EditorOps {
  return {
    split: (clipId, frame) => edits.command(EDITOR_COMMANDS.splitClip, { clipId, at: atRate(frame, rate) }),
    remove: (clipId) => edits.command(EDITOR_COMMANDS.deleteClip, { clipId, mode: 'ripple' }),
    speed: (clipId, speed) =>
      edits.command(EDITOR_COMMANDS.setSpeed, {
        clipId,
        speed: speed === 1 ? { kind: 'normal' } : { kind: 'constant', speed },
      }),
    transition: (clipId, kind) =>
      kind === 'cut'
        ? edits.command(EDITOR_COMMANDS.removeTransition, { clipId, edge: 'end' })
        : edits.command(EDITOR_COMMANDS.setTransition, { clipId, edge: 'end', kind, direction: null }),
    grade: (target, patch) =>
      edits.command(EDITOR_COMMANDS.setGrade, {
        target: target === 'video' ? { kind: 'timeline' } : { kind: 'clips', clipIds: target.clipIds },
        grade: patch,
      }),
    volume: (clipId, change) =>
      edits.command(AUDIO_EDIT_COMMANDS.setVolume, {
        target: { kind: 'clips', clipIds: [clipId] },
        ...(change.gainDb === undefined ? {} : { gainDb: change.gainDb }),
        ...(change.muted === undefined ? {} : { muted: change.muted }),
        ...(change.fadeInSeconds === undefined ? {} : { fadeIn: seconds(change.fadeInSeconds, rate) }),
        ...(change.fadeOutSeconds === undefined ? {} : { fadeOut: seconds(change.fadeOutSeconds, rate) }),
      }),
  };
}

/** The clip's speed now: 1 without a ramp, the first point's otherwise. */
export function speedOf(clip: ClipView): number {
  return clip.item.speed?.points[0]?.speed ?? 1;
}

/** The transition into the next clip, if there is one. */
export function transitionAfter(model: TimelineModel, clip: ClipView): TransitionItem | null {
  return model.transitions.find((entry) => entry.at === clip.end)?.item ?? null;
}

/** Whether the clip has a next clip to go into. */
export function hasNext(model: TimelineModel, clip: ClipView): boolean {
  const after = model.positions[clip.index + 1];
  return after?.item.type === 'clip';
}

export const transitionChoice = (item: TransitionItem | null): TransitionChoice =>
  item && (TRANSITION_CHOICES as readonly string[]).includes(item.kind)
    ? (item.kind as DrawnTransitionKind)
    : 'cut';

/** Seconds of a fade, to the nearest offered choice. */
export function fadeSeconds(time: { value: number; rate: FrameRate } | undefined): number {
  if (!time) return 0;
  const exact = (time.value * time.rate.den) / time.rate.num;
  return FADE_CHOICES.reduce(
    (best, choice) => (Math.abs(choice - exact) < Math.abs(best - exact) ? choice : best),
    0,
  );
}
