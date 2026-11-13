// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The slot edits (P2-T6, SPEC "Slot edit commands") as pure functions:
 * (template, input) → the next version's document, or an error the user can
 * act on. Version numbers, the parent and the time are the service's
 * (template-service.ts), which also validates the result: a broken document
 * here is a bug.
 *
 * Merge and drop move time between neighbours and never move any other cut,
 * so every other slot keeps its beat. Overlays and contact-sheet tiles that
 * pointed at a removed slot are re-pointed to the slot that took its time.
 * BRK1: each edit resolves the doubts it answers (doubts.ts).
 */
import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type Result,
  type SlotId,
  type SlotIntentPatch,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';
import { LastSlot, SlotApproved, SlotNotFound, SlotsNotAdjacent } from '../errors';
import { CUT_DOUBTS, INTENT_DOUBTS, MOTION_DOUBTS, onlyDoubts, withDoubts, withoutDoubts } from './doubts';
import { anchorAt, beatFrames, computePacing } from './timing';

/** Who wrote an intent: the UI (a person) or the agent. */
export type IntentAuthor = 'user' | 'analyst';

function indexOf(template: Template, slotId: SlotId): Result<number> {
  const index = template.slots.findIndex((slot) => slot.id === slotId);
  return index < 0 ? err(SlotNotFound()) : ok(index);
}

/** Recomputes what depends on the slots: pacing. */
function withSlots(
  template: Template,
  slots: TemplateSlot[],
  repoint?: ReadonlyMap<SlotId, SlotId>,
): Template {
  const target = (id: SlotId | null): SlotId | null => (id !== null ? (repoint?.get(id) ?? id) : null);
  return {
    ...template,
    slots,
    text: repoint ? template.text.map((item) => ({ ...item, slotId: target(item.slotId) })) : template.text,
    contactSheet:
      repoint && template.contactSheet
        ? {
            ...template.contactSheet,
            frames: template.contactSheet.frames.map((frame) => ({ ...frame, slotId: target(frame.slotId) })),
          }
        : template.contactSheet,
    pacing: computePacing(slots, template.beatMap, template.canvas.rate),
  };
}

export function approveSlots(
  template: Template,
  input: { readonly slotIds: readonly SlotId[]; readonly approved: boolean },
): Result<Template> {
  const ids = new Set(input.slotIds);
  for (const id of ids) if (!template.slots.some((slot) => slot.id === id)) return err(SlotNotFound());
  // Approving answers the slot's own doubts (its cut and description), not its overlays'.
  const slots = template.slots.map((slot) =>
    ids.has(slot.id)
      ? input.approved
        ? withoutDoubts({ ...slot, approved: true })
        : { ...slot, approved: false }
      : slot,
  );
  return ok(withSlots(template, slots));
}

export function renameSlot(
  template: Template,
  input: { readonly slotId: SlotId; readonly name: string | null },
): Result<Template> {
  const index = indexOf(template, input.slotId);
  if (!index.ok) return index;
  const slots = template.slots.map((slot, i) => (i === index.value ? { ...slot, name: input.name } : slot));
  return ok(withSlots(template, slots));
}

/**
 * Adjacent slots, given in order, become one: the first's id, name, start,
 * anchor and transition in; the summed duration; the intent of `intentFrom`
 * (default the longest, ties the first); no ramp; not approved.
 */
export function mergeSlots(
  template: Template,
  input: { readonly slotIds: readonly SlotId[]; readonly intentFrom?: SlotId | undefined },
): Result<Template> {
  const indices: number[] = [];
  for (const id of input.slotIds) {
    const index = indexOf(template, id);
    if (!index.ok) return index;
    indices.push(index.value);
  }
  if (indices.length < 2 || indices.some((index, i) => index !== indices[0]! + i))
    return err(SlotsNotAdjacent());
  const group = indices.map((index) => template.slots[index]!);
  const first = group[0]!;
  let source = group[0]!;
  if (input.intentFrom !== undefined) {
    const chosen = group.find((slot) => slot.id === input.intentFrom);
    if (!chosen) return err(SlotNotFound());
    source = chosen;
  } else {
    for (const slot of group) if (RationalTime.compare(slot.duration, source.duration) > 0) source = slot;
  }
  const duration = group.slice(1).reduce((sum, slot) => RationalTime.add(sum, slot.duration), first.duration);
  // The first slot's cut stays, and the intent's doubt comes with the intent; a merged fade tail is answered.
  // FRM1-MOT: the measured move and its doubt come with the intent too.
  const { motionMeasure: _firstMeasure, ...firstRest } = first;
  const merged = withDoubts<TemplateSlot>(
    {
      ...firstRest,
      ...(source.motionMeasure ? { motionMeasure: source.motionMeasure } : {}),
      duration,
      intent: source.intent,
      speedRamp: null,
      approved: false,
    },
    [
      ...onlyDoubts(first.doubts, CUT_DOUBTS),
      ...onlyDoubts(source.doubts, [...INTENT_DOUBTS, ...MOTION_DOUBTS]),
    ],
  );
  const slots = [
    ...template.slots.slice(0, indices[0]),
    merged,
    ...template.slots.slice(indices[indices.length - 1]! + 1),
  ];
  const repoint = new Map(group.slice(1).map((slot) => [slot.id, first.id] as const));
  return ok(withSlots(template, slots, repoint));
}

/**
 * Removes a slot and gives its time to the previous slot (the next, if it was
 * first), so the length and every other cut stay where they were. A first
 * slot's successor now starts at zero: it takes the hook role, loses its
 * transition in and its ramp (whose times counted from its old start), and is
 * re-anchored.
 */
export function dropSlot(template: Template, input: { readonly slotId: SlotId }): Result<Template> {
  const found = indexOf(template, input.slotId);
  if (!found.ok) return found;
  if (template.slots.length === 1) return err(LastSlot());
  const index = found.value;
  const dropped = template.slots[index]!;
  const slots = template.slots.filter((_, i) => i !== index);
  let absorbing: TemplateSlot;
  if (index > 0) {
    const previous = slots[index - 1]!;
    absorbing = { ...previous, duration: RationalTime.add(previous.duration, dropped.duration) };
    slots[index - 1] = absorbing;
  } else {
    const next = slots[0]!;
    const rate = template.canvas.rate;
    // No cut at zero: its cut doubts go.
    absorbing = withoutDoubts(
      {
        ...next,
        role: dropped.role === 'hook' ? 'hook' : next.role,
        start: RationalTime.zero(rate),
        duration: RationalTime.add(next.duration, dropped.duration),
        transitionIn: null,
        speedRamp: null,
        beatAnchor: template.beatMap ? anchorAt(beatFrames(template.beatMap, rate), 0, rate) : null,
      },
      CUT_DOUBTS,
    );
    slots[0] = absorbing;
  }
  return ok(withSlots(template, slots, new Map([[dropped.id, absorbing.id]])));
}

/**
 * Patches a slot's intent. From the UI the intent becomes the user's; from
 * the agent the Analyst's, and the agent may not touch an approved slot.
 */
export function editIntent(
  template: Template,
  input: { readonly slotId: SlotId; readonly intent: SlotIntentPatch },
  author: IntentAuthor,
): Result<Template> {
  const index = indexOf(template, input.slotId);
  if (!index.ok) return index;
  const slot = template.slots[index.value]!;
  if (author === 'analyst' && slot.approved) return err(SlotApproved());
  const intent = { ...slot.intent, ...input.intent, source: author };
  if (intent.text.trim().length === 0)
    return err(ValidationError({ field: 'intent.text' }, { detail: 'A written intent needs its text' }));
  // FRM1-MOT: a motion given answers the camera's doubt too.
  const answered = input.intent.motion === undefined ? INTENT_DOUBTS : [...INTENT_DOUBTS, ...MOTION_DOUBTS];
  const slots = template.slots.map((item, i) =>
    i === index.value ? withoutDoubts({ ...item, intent }, answered) : item,
  );
  return ok(withSlots(template, slots));
}
