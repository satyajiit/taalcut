// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: what's wrong, in facts the card puts in plain words, pure: the counts over the video ("This video needs 13
 * clips. 12 of yours fit, so 1 shot has nothing."), what each shot asks for in the template's own words made short
 * ("none of your clips shows someone checking a phone") and the clip that comes closest. Nothing here is invented:
 * the words are the intent's, cut down; the clips and fits are the reader's.
 */
import type { GapSummary } from '@taalcut/core';
import { shotCount } from './ask-policy';
import type { GapShot, GapSlot, GapTimeline } from './gap-types';
import { openSlots } from './proposals';

/** The clip that comes closest to a shot; `usedIn` when another shot shows it now (core's gapClosestSchema). */
export interface GapClosest extends GapShot {
  readonly usedIn: number | null;
}

/** At most this many characters of a shot's wants (core allows 120). */
const WANTS_MAX = 80;

/** How a shot is framed, which the sentence "none of your clips shows …" doesn't need. */
const FRAMING =
  /^(?:(?:an?|the)\s+)?(?:(?:extreme|tight|slow|quick|static|handheld|vertical)\s+)?(?:(?:close[- ]?up|wide|medium|establishing|detail|drone|aerial|tracking|top[- ]down|overhead|over[- ]the[- ]shoulder|pov|insert|cutaway|b[- ]roll)\s*)?(?:shot|view|angle|clip)?\s*(?:of|on|showing|where|with)\s+/i;

/** The first clause of a sentence: up to its first full stop, comma, semicolon, colon or dash. */
function firstClause(text: string): string {
  const cut = text.search(/[.,;:!?]\s|[.,;:!?]$|\s[-–—]\s/);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

/** Cut at a word boundary, with an ellipsis when anything went. */
function cutWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  return `${(space > max / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/**
 * What a shot asks for, made short from the template's intent: its first clause, without a label ("POV:") or how it
 * is framed ("A close-up of"), a capital dropped only where the next word is lower case (so "Tokyo Tower" keeps its
 * own), at most 80 characters. Null when the template says nothing.
 */
export function shortWants(text: string | null | undefined): string | null {
  const whole = text?.replace(/\s+/g, ' ').trim() ?? '';
  if (!whole) return null;
  // A short label before a colon ("POV: walking in", "Close-up: hands") says how, not what.
  const unlabelled = whole.replace(/^[^.:!?]{1,24}:\s+(?=\S)/, '');
  const clause = firstClause(unlabelled) || unlabelled;
  const bare = clause.replace(FRAMING, '').trim() || clause;
  const [first = '', second = ''] = bare.split(' ');
  const lower =
    first.length > 1 && /^[A-Z][a-z]/.test(first) && (second === '' || /^[a-z]/.test(second))
      ? `${first[0]!.toLowerCase()}${bare.slice(1)}`
      : bare;
  return cutWords(lower, WANTS_MAX);
}

/** The counts over one timeline's video: its shots, those with a clip, with none, and the unsure ones. */
export function summaryOf(timeline: GapTimeline): GapSummary {
  const open = openSlots(timeline);
  const shots = shotCount(timeline);
  const empty = open.filter((slot) => slot.state === 'empty').length;
  return {
    shots,
    filled: Math.max(0, shots - empty),
    empty,
    unsure: open.filter((slot) => slot.state === 'weak').length,
  };
}

const closest = (shot: GapShot, usedIn: number | null): GapClosest => ({
  assetId: shot.assetId,
  shotId: shot.shotId,
  description: shot.description?.slice(0, 300) ?? null,
  fit: Math.min(1, Math.max(0, shot.fit)),
  usedIn,
});

/**
 * The clip that comes closest to what a gap asks for: the best fit among the clips it could take (the unsure pick's
 * next-best, another shot's clip, another part of a used clip). For an unsure pick only one that fits better than
 * the clip in it now counts (the card already says how well that one fits). Null when none does.
 */
export function closestOf(slot: GapSlot): GapClosest | null {
  const floor = slot.state === 'weak' ? (slot.weak?.pick.fit ?? 0) : 0;
  const offered: GapClosest[] = [
    ...(slot.weak?.candidates ?? []).map((shot) => closest(shot, null)),
    ...(slot.offers?.borrow ?? []).map((shot) => closest(shot, shot.from.number)),
    ...(slot.offers?.reuse ?? []).map((shot) => closest(shot, shot.usedIn)),
  ];
  const best = offered.filter((c) => c.fit > floor).sort((a, b) => b.fit - a.fit)[0];
  return best ?? null;
}
