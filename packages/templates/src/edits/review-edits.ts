// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The review's other edits (BRK1-CMD) as pure functions: a slot's role, "Not text", half or double the tempo,
 * dismissing a doubt, and (BRK1-REV) the reel's sound credit. None moves a cut. A tempo change re-anchors every slot on the new beats and recomputes how
 * many cuts sit on a beat.
 */
import {
  err,
  ok,
  RationalTime,
  type CameraMotion,
  TemplateDoubtNotFound,
  TemplateOverlayNotFound,
  type DoubtReason,
  type DoubtTarget,
  type Result,
  type SlotId,
  type SoundCredit,
  type Template,
  type TemplateSlot,
  type TempoFactor,
  type TextOverlayId,
} from '@taalcut/core';
import { NoBeatMap, SlotNotFound } from '../errors';
import { hasDoubt, MOTION_DOUBTS, withoutDoubts } from './doubts';
import { withoutGoneOverlays } from './graphic-edits';
import { scaleBeatMap } from './tempo';
import { anchorAt, beatFrames, computePacing } from './timing';

export function setRole(
  template: Template,
  input: { readonly slotId: SlotId; readonly role: TemplateSlot['role'] },
): Result<Template> {
  if (!template.slots.some((slot) => slot.id === input.slotId)) return err(SlotNotFound());
  return ok({
    ...template,
    slots: template.slots.map((slot) => (slot.id === input.slotId ? { ...slot, role: input.role } : slot)),
  });
}

/** Removes overlays (the review's "Not text"); their doubts go with them. Every id must exist. */
export function removeText(
  template: Template,
  input: { readonly overlayIds: readonly TextOverlayId[] },
): Result<Template> {
  const ids = new Set(input.overlayIds);
  const known = new Set(template.text.map((item) => item.id));
  for (const id of ids) if (!known.has(id)) return err(TemplateOverlayNotFound());
  // DSG1-READ: their briefs and uses go with them.
  return ok(withoutGoneOverlays({ ...template, text: template.text.filter((item) => !ids.has(item.id)) }));
}

/** Halves or doubles the beat map; every slot is anchored again, `bpm` follows, the tempo doubt is answered. */
export function setTempo(template: Template, input: { readonly factor: TempoFactor }): Result<Template> {
  if (!template.beatMap) return err(NoBeatMap());
  const beatMap = scaleBeatMap(template.beatMap, input.factor);
  if (!beatMap.ok) return beatMap;
  const rate = template.canvas.rate;
  const beats = beatFrames(beatMap.value, rate);
  const slots = template.slots.map((slot) => ({
    ...slot,
    beatAnchor: anchorAt(beats, RationalTime.toFrames(slot.start, rate), rate),
  }));
  return ok(
    withoutDoubts(
      { ...template, beatMap: beatMap.value, slots, pacing: computePacing(slots, beatMap.value, rate) },
      ['tempoMaybeHalfOrDouble'],
    ),
  );
}

/** Removes one doubt from a slot, an overlay or the template; one it doesn't have is templates.doubt_not_found. */
export function dismissDoubt(
  template: Template,
  input: { readonly target: DoubtTarget; readonly reason: DoubtReason },
): Result<Template> {
  const { target, reason } = input;
  if (target.kind === 'template') {
    if (!hasDoubt(template, reason)) return err(TemplateDoubtNotFound());
    return ok(withoutDoubts(template, [reason]));
  }
  if (target.kind === 'slot') {
    const slot = template.slots.find((item) => item.id === target.slotId);
    if (!slot) return err(SlotNotFound());
    if (!hasDoubt(slot, reason)) return err(TemplateDoubtNotFound());
    return ok({
      ...template,
      slots: template.slots.map((item) => (item === slot ? withoutDoubts(item, [reason]) : item)),
    });
  }
  const overlay = template.text.find((item) => item.id === target.overlayId);
  if (!overlay) return err(TemplateOverlayNotFound());
  if (!hasDoubt(overlay, reason)) return err(TemplateDoubtNotFound());
  return ok({
    ...template,
    text: template.text.map((item) => (item === overlay ? withoutDoubts(item, [reason]) : item)),
  });
}

/**
 * Writes the reel's sound credit to `audio.sound` (BRK1-REV): its title, artist and link as the person gave them, and
 * the template's `soundCreditMissing` is answered. Null clears the credit and leaves the doubts as they are.
 */
export function setSoundCredit(
  template: Template,
  input: { readonly credit: SoundCredit | null },
): Result<Template> {
  const { credit } = input;
  if (!credit) return ok({ ...template, audio: { ...template.audio, sound: null } });
  const sound = {
    title: credit.title ?? null,
    artist: credit.artist ?? null,
    ...(credit.url ? { url: credit.url } : {}),
  };
  return ok(withoutDoubts({ ...template, audio: { ...template.audio, sound } }, ['soundCreditMissing']));
}

/**
 * FRM1-MOT: the camera's move a person picked in the review (`template.setMotion`): the slot's motion, null for
 * "I don't know"; the measure stays as it was, and the slot's `motionUnsure` is answered either way.
 */
export function setMotion(
  template: Template,
  input: { readonly slotId: SlotId; readonly motion: CameraMotion | null },
): Result<Template> {
  if (!template.slots.some((slot) => slot.id === input.slotId)) return err(SlotNotFound());
  return ok({
    ...template,
    slots: template.slots.map((slot) =>
      slot.id === input.slotId
        ? withoutDoubts({ ...slot, intent: { ...slot.intent, motion: input.motion } }, MOTION_DOUBTS)
        : slot,
    ),
  });
}
