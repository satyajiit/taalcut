// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { RationalTime, Template } from '@taalcut/core';

type Slot = Template['slots'][number];
type Intent = Slot['intent'];

/**
 * A template's times as numbers, for drawing and for Intl (the kit may import
 * only types from core, so this is the one line of RationalTime it needs).
 */
export function toSeconds(time: Pick<RationalTime, 'value' | 'rate'>): number {
  return (time.value * time.rate.den) / time.rate.num;
}

export const ROLE_LABELS: Readonly<Record<Slot['role'], MessageDescriptor>> = {
  hook: msg`Hook`,
  body: msg`Middle`,
  peak: msg`Peak`,
  outro: msg`Ending`,
};

export const SHOT_TYPE_LABELS: Readonly<Record<NonNullable<Intent['shotType']>, MessageDescriptor>> = {
  wide: msg`Wide`,
  medium: msg`Medium`,
  close: msg`Close-up`,
  detail: msg`Detail`,
  pov: msg`First person`,
  aerial: msg`Aerial`,
  screen: msg`Screen`,
  text: msg`Text card`,
};

export const MOTION_LABELS: Readonly<Record<NonNullable<Intent['motion']>, MessageDescriptor>> = {
  static: msg`Still camera`,
  pan: msg`Pan`,
  tilt: msg`Tilt`,
  'push-in': msg`Push in`,
  'pull-out': msg`Pull out`,
  handheld: msg`Handheld`,
  tracking: msg`Tracking`,
};

/** FRM1-MOT: what each camera move means, in a line, for the review's picker. */
export const MOTION_HINTS: Readonly<Record<NonNullable<Intent['motion']>, MessageDescriptor>> = {
  static: msg`The camera doesn’t move`,
  pan: msg`Turns left or right`,
  tilt: msg`Turns up or down`,
  'push-in': msg`Moves closer`,
  'pull-out': msg`Moves back`,
  handheld: msg`Held by hand, a little shaky`,
  tracking: msg`Follows someone or something`,
};

const CUT_LABELS: Readonly<Record<Slot['cut']['method'], MessageDescriptor>> = {
  both: msg`The cut and the frames agree`,
  scdet: msg`Found from the cut`,
  embedding: msg`Found from the frames`,
  vision: msg`Found by looking at the frames`,
  rule: msg`The start of the reel`,
  format: msg`Set by the format`,
  user: msg`Set by you`,
};

export function cutLabel(i18n: I18n, method: Slot['cut']['method']): string {
  return i18n._(CUT_LABELS[method]);
}

/** Energy in words: how much happens in the shot. */
export function energyLabel(i18n: I18n, energy: number): string {
  if (energy >= 0.75) return i18n._(msg`Fast and busy`);
  if (energy >= 0.45) return i18n._(msg`Lively`);
  return i18n._(msg`Calm`);
}

/** Which beats a slot covers: its first beat and how many, from the beat map. */
export function slotBeats(template: Template, slot: Slot): { first: number; count: number } | null {
  const map = template.beatMap;
  if (!map) return null;
  const start = toSeconds(slot.start);
  const end = start + toSeconds(slot.duration);
  const times = map.beats.map(toSeconds);
  const inside = times.filter((t) => t >= start - 0.02 && t < end - 0.02);
  if (inside.length === 0) return null;
  return { first: times.indexOf(inside[0]!) + 1, count: inside.length };
}
