// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a variant differs in from its base (P3-V3, core's variantDifferenceSchema), for the tool's result and the
 * `variantsCompare` card: the hook shot, the share of slots showing another shot, the music and the caption look.
 */
import { isDeepStrictEqual } from 'node:util';
import type { Timeline, VariantDifference } from '@taalcut/core';
import { shownBySlot } from '../model/slot-shots';
import { captionPresetOf } from '../styles/caption-look';

/** Slots (the base's, in V1 order) where `a` and `b` show different shots. */
export function slotsDiffering(a: Timeline, b: Timeline): string[] {
  const left = shownBySlot(a);
  const right = shownBySlot(b);
  return [...left.keys()].filter((slotId) => left.get(slotId) !== right.get(slotId));
}

export function variantDifference(base: Timeline, variant: Timeline): VariantDifference {
  const slots = [...shownBySlot(base).keys()];
  const differing = new Set(slotsDiffering(base, variant));
  const hook = slots[0];
  const sameLook = isDeepStrictEqual(base.captions?.style ?? null, variant.captions?.style ?? null);
  return {
    timelineId: variant.id,
    hookChanged: hook !== undefined && differing.has(hook),
    picksChanged: slots.length === 0 ? 0 : differing.size / slots.length,
    music: isDeepStrictEqual(base.music, variant.music) ? null : variant.music,
    captionPreset: sameLook ? null : captionPresetOf(variant.captions),
  };
}
