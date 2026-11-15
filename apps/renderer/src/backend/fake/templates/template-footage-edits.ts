// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- reasons are developer detail for the errors, never shown */

/**
 * KEEP1: `template.slot.setFootage` as the renderer's fake makes it, a pure function on Template v1 like the review's
 * other edits (template-review-edits.ts). The real one is @taalcut/templates'. It states whose footage a slot plays
 * in a video made from the template: the person's (`person`) or the reel's own (`reel`). The statement becomes the
 * person's (`by: 'user'`) and keeps the reason Taalcut wrote, so the review still says why it read the slot that
 * way. Setting the value a slot already has is still a new version. Refused with core's codes: `reel` on a template
 * that was not made from a reel (templates.no_reel), and a change that would leave no slot for the person's clips
 * (templates.no_person_slot). A split copies the statement to both halves (the slot is spread into each); a merge
 * takes it from the slot whose intent it takes (template-edits.ts).
 */
import {
  TemplateNoPersonSlot,
  TemplateNoReel,
  type Id,
  type SlotFootageSource,
  type Template,
} from '@taalcut/core';
import type { SlotEditResult } from './template-edits';

const refuse = (error: typeof TemplateNoReel, detail: string): SlotEditResult => ({
  ok: false,
  reason: detail,
  error: error(undefined, { detail }),
});

export function setFootage(
  template: Template,
  slotId: Id<'TemplateSlot'>,
  from: SlotFootageSource,
  now: number,
): SlotEditResult {
  if (!template.slots.some((slot) => slot.id === slotId)) return { ok: false, reason: 'No such slot' };
  if (from === 'reel' && template.origin.kind !== 'reference')
    return refuse(TemplateNoReel, 'The template was not made from a reel');
  const slots = template.slots.map((slot) =>
    slot.id === slotId
      ? { ...slot, footage: { from, by: 'user' as const, reason: slot.footage?.reason ?? null } }
      : slot,
  );
  if (slots.every((slot) => slot.footage?.from === 'reel'))
    return refuse(TemplateNoPersonSlot, 'No slot would be left for the person’s clips');
  return {
    ok: true,
    template: {
      ...template,
      version: template.version + 1,
      parentVersion: template.version,
      createdAt: now,
      slots,
    },
  };
}
