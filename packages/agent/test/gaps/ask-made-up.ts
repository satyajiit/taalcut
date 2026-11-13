// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK's made-up timelines for the pure tests: shots by state, each with an intent, an unsure clip where asked
 * for, and offers from the rest of the video. Every id, word and fit is invented.
 */
import { FrameRates, newId, RationalTime } from '@taalcut/core';
import type { BorrowShot, GapShot, GapSlot, GapTimeline, ReuseShot, WeakPickInfo } from '@taalcut/agent';

const fps = FrameRates.fps30;
export const SHOT_FRAMES = 60;

export const clip = (description: string | null, fit: number): GapShot => ({
  assetId: newId<'Asset'>(),
  shotId: newId<'Shot'>(),
  description,
  fit,
});

export function unsure(fit: number, candidates: GapShot[] = [], better: GapShot | null = null): WeakPickInfo {
  return { pick: clip('A neon sign over a shop door at night', fit), confidence: 0.1, candidates, better };
}

export interface MadeUpShot {
  readonly state: GapSlot['state'];
  readonly intent?: string;
  readonly weak?: WeakPickInfo;
  readonly carries?: GapSlot['carries'];
  readonly offers?: GapSlot['offers'];
}

/** A timeline of `shots`, numbered from 1; a picked shot gets a clip of its own. */
export function madeUp(shots: readonly MadeUpShot[], minSeconds: number | null = null): GapTimeline {
  const slots: GapSlot[] = shots.map((shot, index) => {
    const own = shot.weak?.pick ?? (shot.state === 'picked' ? clip('A street at dusk', 0.7) : undefined);
    return {
      gapId: newId<'TimelineItem'>(),
      slotId: newId<'TemplateSlot'>(),
      number: index + 1,
      start: RationalTime.of(index * SHOT_FRAMES, fps),
      duration: RationalTime.of(SHOT_FRAMES, fps),
      intent: {
        text: shot.intent ?? `Shot ${index + 1}'s moment`,
        shotType: null,
        motion: null,
        energy: 0.5,
      },
      state: shot.state,
      note: shot.state === 'empty' ? 'noCandidates' : null,
      ...(shot.weak ? { weak: shot.weak } : {}),
      ...(own ? { current: { assetId: own.assetId, shotId: own.shotId } } : {}),
      ...(shot.carries ? { carries: shot.carries } : {}),
      ...(shot.offers ? { offers: shot.offers } : {}),
    };
  });
  return {
    timelineId: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    revision: 3,
    duration: RationalTime.of(SHOT_FRAMES * shots.length, fps),
    minDuration: minSeconds === null ? null : RationalTime.fromSeconds(minSeconds, fps),
    slots,
    slotCount: slots.filter((s) => s.state !== 'dropped').length,
  };
}

/** `count` shots casting is sure of. */
export const sure = (count: number): MadeUpShot[] =>
  Array.from({ length: count }, () => ({ state: 'picked' }));

/** A borrow offer: a clip shot `from` has, how well it fits here and there, and what that shot gets instead. */
export function borrowFrom(
  giver: GapSlot,
  fitHere: number,
  instead: GapShot,
  better = true,
  description = 'Someone checks a phone on a bench',
): BorrowShot {
  return {
    assetId: giver.current!.assetId,
    shotId: giver.current!.shotId,
    description,
    fit: fitHere,
    better,
    from: {
      gapId: giver.gapId,
      slotId: giver.slotId,
      number: giver.number,
      fit: giver.weak?.pick.fit ?? 0.3,
    },
    instead,
  };
}

/** A reuse offer: another part of the clip shot `user` shows. */
export function reuseOf(user: GapSlot, fitHere: number, startFrame = 300): ReuseShot {
  return {
    assetId: user.current!.assetId,
    shotId: user.current!.shotId,
    description: 'A long walk down a lit walkway',
    fit: fitHere,
    usedIn: user.number,
    sourceStart: RationalTime.of(startFrame, fps),
  };
}
