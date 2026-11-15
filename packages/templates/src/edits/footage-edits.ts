// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: `template.slot.setFootage`, whose footage a slot plays (core's slot-footage.ts), as a pure function like
 * the other slot edits. The breakdown review's "Keep the reel's clip" and "Use my clip" dispatch it; the statement
 * becomes the author's and keeps the reason the slot had, so the review still says why the Analyst read it so.
 *
 * Two things are refused, both for what a tool can know for certain: the reel's footage on a template that was not
 * made from a reel (there is no reel to keep), and a change that leaves no slot for the person's clips (the video
 * would be the reel again). Whether the template's reel is still on this Mac is assembly's to check, where it is
 * needed: a template whose reel was deleted can still say what it keeps, and fetching the reel again mends it.
 */
import {
  err,
  keepsReelFootage,
  ok,
  TemplateNoPersonSlot,
  TemplateNoReel,
  type Result,
  type SlotFootageAuthor,
  type SlotFootageSource,
  type SlotId,
  type Template,
} from '@taalcut/core';
import { SlotApproved, SlotNotFound } from '../errors';

/**
 * No edit may leave a template with no slot for the person's clips: dropping or merging away the last one is
 * refused like the statement that would do it. The template commands hold every edit to it.
 */
export function withPersonSlot(edited: Result<Template>): Result<Template> {
  return edited.ok && edited.value.slots.every(keepsReelFootage) ? err(TemplateNoPersonSlot()) : edited;
}

export function setFootage(
  template: Template,
  input: { readonly slotId: SlotId; readonly from: SlotFootageSource },
  author: SlotFootageAuthor,
): Result<Template> {
  const index = template.slots.findIndex((slot) => slot.id === input.slotId);
  if (index < 0) return err(SlotNotFound());
  const slot = template.slots[index]!;
  // As with an intent: what the person confirmed is theirs, and the agent leaves it alone.
  if (author === 'analyst' && slot.approved) return err(SlotApproved());
  if (input.from === 'reel' && template.origin.kind !== 'reference') return err(TemplateNoReel());
  const slots = template.slots.map((item, i) =>
    i === index
      ? { ...item, footage: { from: input.from, by: author, reason: item.footage?.reason ?? null } }
      : item,
  );
  return withPersonSlot(ok({ ...template, slots }));
}
