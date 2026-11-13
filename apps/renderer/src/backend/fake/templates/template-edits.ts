// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- reasons are developer detail for ValidationError, never shown */

/**
 * The structural slot edits as pure functions on Template v1: each returns the
 * next version (parent = the version it was made on) with the invariants kept,
 * so core's templateSchema still accepts it. The real edits are
 * @taalcut/templates'; these are the renderer fake's, for the pages and the
 * breakdown card to run against. Dropping a slot gives its time to the slot
 * before it (the first slot's goes to the next), merged slots take the first
 * slot's intent unless another is named, and text moves with its slot.
 */
import type { Id, TaalcutError, Template } from '@taalcut/core';

type Slot = Template['slots'][number];
type SlotId = Id<'TemplateSlot'>;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Recomputes what depends on the slots: starts, pacing and the moved text's slot ids. */
function settle(
  template: Template,
  slots: Slot[],
  moved: ReadonlyMap<SlotId, SlotId>,
  now: number,
): Template {
  const rate = template.canvas.rate;
  let start = 0;
  const tiled = slots.map((slot, index) => {
    const placed = {
      ...slot,
      start: { value: start, rate },
      // The first slot never has a transition in.
      transitionIn: index === 0 ? null : slot.transitionIn,
    };
    start += slot.duration.value;
    return placed;
  });
  const lengths = tiled.map((slot) => slot.duration.value);
  const remap = (id: SlotId | null) => (id === null ? null : (moved.get(id) ?? id));
  return {
    ...template,
    version: template.version + 1,
    parentVersion: template.version,
    createdAt: now,
    slots: tiled,
    text: template.text.map((item) => ({ ...item, slotId: remap(item.slotId) })),
    contactSheet: template.contactSheet
      ? {
          ...template.contactSheet,
          frames: template.contactSheet.frames.map((frame) => ({ ...frame, slotId: remap(frame.slotId) })),
        }
      : null,
    pacing: {
      ...template.pacing,
      shotCount: tiled.length,
      meanShot: { value: Math.round(start / tiled.length), rate },
      medianShot: { value: median(lengths), rate },
      shortestShot: { value: Math.min(...lengths), rate },
      longestShot: { value: Math.max(...lengths), rate },
      hookEnd: { value: Math.min(tiled[0]!.duration.value, Math.round((3 * rate.num) / rate.den)), rate },
    },
  };
}

/** A refusal's `error`, when there is one, is what the command answers (BRK1: core's own codes); else a validation error. */
export type SlotEditResult =
  { ok: true; template: Template } | { ok: false; reason: string; error?: TaalcutError };

export function renameSlot(
  template: Template,
  slotId: SlotId,
  name: string | null,
  now: number,
): SlotEditResult {
  if (!template.slots.some((slot) => slot.id === slotId)) return { ok: false, reason: 'No such slot' };
  const slots = template.slots.map((slot) => (slot.id === slotId ? { ...slot, name } : slot));
  return { ok: true, template: settle(template, slots, new Map(), now) };
}

export function approveSlots(
  template: Template,
  slotIds: readonly SlotId[],
  approved: boolean,
  now: number,
): SlotEditResult {
  const wanted = new Set(slotIds);
  if (![...wanted].every((id) => template.slots.some((slot) => slot.id === id)))
    return { ok: false, reason: 'No such slot' };
  const slots = template.slots.map((slot) => (wanted.has(slot.id) ? { ...slot, approved } : slot));
  return { ok: true, template: settle(template, slots, new Map(), now) };
}

/** Consecutive slots become one; the result keeps the first slot's id. */
export function mergeSlots(
  template: Template,
  slotIds: readonly SlotId[],
  intentFrom: SlotId | undefined,
  now: number,
): SlotEditResult {
  const indices = slotIds
    .map((id) => template.slots.findIndex((slot) => slot.id === id))
    .sort((a, b) => a - b);
  if (indices.length < 2 || indices.includes(-1)) return { ok: false, reason: 'No such slot' };
  if (indices.some((index, i) => i > 0 && index !== indices[i - 1]! + 1))
    return { ok: false, reason: 'Only slots next to each other can be merged' };
  const group = indices.map((index) => template.slots[index]!);
  const first = group[0]!;
  const source = group.find((slot) => slot.id === intentFrom) ?? first;
  const merged: Slot = {
    ...first,
    duration: { value: group.reduce((sum, slot) => sum + slot.duration.value, 0), rate: first.duration.rate },
    intent: source.intent,
    name: first.name ?? source.name,
    approved: group.every((slot) => slot.approved),
    speedRamp: null,
  };
  const moved = new Map(group.slice(1).map((slot) => [slot.id, first.id] as const));
  const slots = [
    ...template.slots.slice(0, indices[0]),
    merged,
    ...template.slots.slice(indices[indices.length - 1]! + 1),
  ];
  return { ok: true, template: settle(template, slots, moved, now) };
}

export function dropSlot(template: Template, slotId: SlotId, now: number): SlotEditResult {
  const index = template.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) return { ok: false, reason: 'No such slot' };
  if (template.slots.length === 1) return { ok: false, reason: 'A template keeps at least one slot' };
  const dropped = template.slots[index]!;
  const heir = index > 0 ? index - 1 : 1;
  const receiver = template.slots[heir]!;
  const grown: Slot = {
    ...receiver,
    duration: { value: receiver.duration.value + dropped.duration.value, rate: receiver.duration.rate },
    speedRamp: null,
    // Dropping the first slot moves the next one's cut to the start, onto the first slot's beat.
    ...(index === 0 ? { beatAnchor: dropped.beatAnchor } : {}),
  };
  const slots = template.slots.flatMap((slot, i) => (i === index ? [] : i === heir ? [grown] : [slot]));
  return { ok: true, template: settle(template, slots, new Map([[dropped.id, receiver.id]]), now) };
}
