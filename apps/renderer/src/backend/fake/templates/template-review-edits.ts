// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- reasons are developer detail for the errors, never shown */

/**
 * BRK1's review edits (contract §2) as the renderer's fake makes them: pure functions on Template v1, each the next
 * version with the invariants kept. The real ones are @taalcut/templates' (lane cmd); these let the review, its e2e
 * and its screenshots run without them. Text overlays, the contact sheet's frames and the beat anchors follow every
 * cut by start time; an edit clears the doubts it answers (§1: a doubt goes when its item is edited or removed).
 */
import {
  newId,
  type CameraMotion,
  TemplateCutOutOfRange,
  TemplateDoubtNotFound,
  TemplateFirstSlotCut,
  TemplateOverlayNotFound,
  ValidationError,
  type CutSnap,
  type DoubtReason,
  type DoubtTarget,
  type Id,
  type RationalTime,
  type SoundCredit,
  type TempoFactor,
  type Template,
} from '@taalcut/core';
import type { SlotEditResult } from './template-edits';

type Slot = Template['slots'][number];
type SlotId = Id<'TemplateSlot'>;
type Doubt = NonNullable<Slot['doubts']>[number];
type Doubted = { readonly doubts?: readonly Doubt[] | undefined };

/** A refusal with the code the real command answers (core's BRK1 errors), and developer detail. */
const refuse = (error: typeof TemplateCutOutOfRange, detail: string): SlotEditResult => ({
  ok: false,
  reason: detail,
  error: error(undefined, { detail }),
});
const missingSlot = (): SlotEditResult => ({ ok: false, reason: 'No such slot' });

const seconds = (time: Pick<RationalTime, 'value' | 'rate'>) => (time.value * time.rate.den) / time.rate.num;

function framesOf(template: Template, time: Pick<RationalTime, 'value' | 'rate'>): number {
  const { num, den } = template.canvas.rate;
  return Math.round((seconds(time) * num) / den);
}

function beatFrames(template: Template): number[] {
  const { num, den } = template.canvas.rate;
  return template.beatMap?.beats.map((beat) => Math.round((seconds(beat) * num) / den)) ?? [];
}

const without = <T extends Doubted>(item: T, reasons: readonly DoubtReason[]): T => {
  if (!item.doubts) return item;
  const doubts = item.doubts.filter((doubt) => !reasons.includes(doubt.reason));
  return { ...item, doubts };
};

/** Starts from the durations, then everything that hangs off the slots by time: text, frames, beat anchors, pacing. */
function settle(template: Template, slots: Slot[], now: number, extra: Partial<Template> = {}): Template {
  const rate = template.canvas.rate;
  const beats = beatFrames({ ...template, ...extra } as Template);
  let start = 0;
  const tiled = slots.map((slot, index) => {
    let anchor = slot.beatAnchor;
    if (beats.length > 0) {
      let best = 0;
      for (let i = 1; i < beats.length; i += 1)
        if (Math.abs(beats[i]! - start) < Math.abs(beats[best]! - start)) best = i;
      anchor = { beatIndex: best, offset: { value: start - beats[best]!, rate } };
    }
    const placed = {
      ...slot,
      start: { value: start, rate },
      beatAnchor: anchor,
      transitionIn: index === 0 ? null : slot.transitionIn,
    };
    start += slot.duration.value;
    return placed;
  });
  const slotAt = (frames: number) => {
    let at = tiled[0]!;
    for (const slot of tiled) if (slot.start.value <= frames) at = slot;
    return at.id;
  };
  const lengths = tiled.map((slot) => slot.duration.value).sort((a, b) => a - b);
  return {
    ...template,
    ...extra,
    version: template.version + 1,
    parentVersion: template.version,
    createdAt: now,
    slots: tiled,
    text: template.text.map((item) => ({ ...item, slotId: slotAt(framesOf(template, item.start)) })),
    contactSheet: template.contactSheet
      ? {
          ...template.contactSheet,
          frames: template.contactSheet.frames.map((frame) => ({
            ...frame,
            slotId: slotAt(framesOf(template, frame.at)),
          })),
        }
      : null,
    pacing: {
      ...template.pacing,
      shotCount: tiled.length,
      meanShot: { value: Math.round(start / tiled.length), rate },
      medianShot: { value: lengths[Math.floor(lengths.length / 2)]!, rate },
      shortestShot: { value: lengths[0]!, rate },
      longestShot: { value: lengths[lengths.length - 1]!, rate },
      hookEnd: { value: Math.min(tiled[0]!.duration.value, Math.round((3 * rate.num) / rate.den)), rate },
    },
  };
}

/** The frame a cut lands on: the nearest beat inside its range when `snap` is 'beat', else the nearest frame. */
function landing(
  template: Template,
  to: RationalTime,
  snap: CutSnap,
  min: number,
  max: number,
): number | null {
  const frames = framesOf(template, to);
  if (snap === 'beat') {
    const inside = beatFrames(template).filter((beat) => beat >= min && beat <= max);
    if (inside.length === 0) return null;
    return inside.reduce((best, beat) => (Math.abs(beat - frames) < Math.abs(best - frames) ? beat : best));
  }
  return frames >= min && frames <= max ? frames : null;
}

const CUT_DOUBTS: readonly DoubtReason[] = ['cutUnsure', 'cutMaybeTransition'];

export function moveCut(
  template: Template,
  slotId: SlotId,
  to: RationalTime,
  snap: CutSnap,
  now: number,
): SlotEditResult {
  const index = template.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) return missingSlot();
  if (index === 0) return refuse(TemplateFirstSlotCut, 'The first slot has no cut before it');
  const before = template.slots[index - 1]!;
  const slot = template.slots[index]!;
  const end = slot.start.value + slot.duration.value;
  const at = landing(template, to, snap, before.start.value + 1, end - 1);
  if (at === null) return refuse(TemplateCutOutOfRange, 'The cut must leave a frame each side');
  const rate = template.canvas.rate;
  const slots = template.slots.map((each, i) =>
    i === index - 1
      ? { ...each, duration: { value: at - before.start.value, rate } }
      : i === index
        ? {
            ...without(each, CUT_DOUBTS),
            duration: { value: end - at, rate },
            cut: { method: 'user' as const, confidence: 1 },
          }
        : each,
  );
  return { ok: true, template: settle(template, slots, now) };
}

export function splitSlot(
  template: Template,
  slotId: SlotId,
  at: RationalTime,
  snap: CutSnap,
  now: number,
): SlotEditResult {
  const index = template.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) return missingSlot();
  if (template.slots.length >= 200)
    return refuse(TemplateCutOutOfRange, 'A template holds at most 200 slots');
  const slot = template.slots[index]!;
  const end = slot.start.value + slot.duration.value;
  const cut = landing(template, at, snap, slot.start.value + 1, end - 1);
  if (cut === null) return refuse(TemplateCutOutOfRange, 'The cut must leave a frame each side');
  const rate = template.canvas.rate;
  const first: Slot = { ...slot, duration: { value: cut - slot.start.value, rate } };
  const second: Slot = {
    ...without(slot, CUT_DOUBTS),
    id: newId<'TemplateSlot'>(),
    name: null,
    role: slot.role === 'hook' ? 'body' : slot.role,
    duration: { value: end - cut, rate },
    intent: { ...slot.intent },
    approved: false,
    cut: { method: 'user', confidence: 1 },
    transitionIn: null,
    speedRamp: null,
  };
  const slots = [...template.slots.slice(0, index), first, second, ...template.slots.slice(index + 1)];
  return { ok: true, template: settle(template, slots, now) };
}

export function setRole(template: Template, slotId: SlotId, role: Slot['role'], now: number): SlotEditResult {
  if (!template.slots.some((slot) => slot.id === slotId)) return missingSlot();
  const slots = template.slots.map((slot) => (slot.id === slotId ? { ...slot, role } : slot));
  return { ok: true, template: settle(template, slots, now) };
}

export function editIntent(
  template: Template,
  slotId: SlotId,
  patch: Partial<Slot['intent']>,
  source: 'ui' | 'shortcut' | 'agent' | 'mcp',
  now: number,
): SlotEditResult {
  if (!template.slots.some((slot) => slot.id === slotId)) return missingSlot();
  const slots = template.slots.map((slot) =>
    slot.id === slotId
      ? {
          ...without(slot, ['intentVague', 'intentGeneralised']),
          intent: {
            ...slot.intent,
            ...patch,
            source: source === 'agent' || source === 'mcp' ? slot.intent.source : ('user' as const),
          },
        }
      : slot,
  );
  return { ok: true, template: settle(template, slots, now) };
}

export function removeText(
  template: Template,
  overlayIds: readonly Id<'TextOverlay'>[],
  now: number,
): SlotEditResult {
  const gone = new Set(overlayIds);
  if (![...gone].every((id) => template.text.some((item) => item.id === id)))
    return refuse(TemplateOverlayNotFound, 'No such text overlay');
  const next = { ...template, text: template.text.filter((item) => !gone.has(item.id)) };
  return { ok: true, template: settle(next, [...template.slots], now) };
}

export function setTempo(template: Template, factor: TempoFactor, now: number): SlotEditResult {
  const map = template.beatMap;
  if (!map)
    return {
      ok: false,
      reason: 'The template has no beats',
      error: ValidationError(undefined, { detail: 'templates.no_beat_map' }),
    };
  const doubled = factor === 2;
  const beats = doubled
    ? map.beats.flatMap((beat, i) => {
        const next = map.beats[i + 1];
        return next ? [beat, { value: Math.round((beat.value + next.value) / 2), rate: beat.rate }] : [beat];
      })
    : map.beats.filter((_, i) => i % 2 === 0);
  const downbeats = doubled
    ? map.downbeats.map((i) => i * 2)
    : map.downbeats.filter((i) => i % 2 === 0).map((i) => i / 2);
  const doubts = (template.doubts ?? []).filter((d) => d.reason !== 'tempoMaybeHalfOrDouble');
  const beatMap = {
    ...map,
    beats,
    downbeats,
    bpm: map.bpm ? map.bpm * factor : null,
    source: 'user' as const,
  };
  return {
    ok: true,
    template: settle(template, [...template.slots], now, { beatMap, doubts }),
  };
}

export function dismissDoubt(
  template: Template,
  target: DoubtTarget,
  reason: DoubtReason,
  now: number,
): SlotEditResult {
  const has = (item: Doubted) => item.doubts?.some((doubt) => doubt.reason === reason) ?? false;
  const missing = refuse(TemplateDoubtNotFound, 'No such doubt');
  if (target.kind === 'template') {
    if (!has(template)) return missing;
    const doubts = (template.doubts ?? []).filter((d) => d.reason !== reason);
    return {
      ok: true,
      template: settle(template, [...template.slots], now, { doubts }),
    };
  }
  if (target.kind === 'slot') {
    const slot = template.slots.find((each) => each.id === target.slotId);
    if (!slot || !has(slot)) return missing;
    const slots = template.slots.map((each) => (each.id === target.slotId ? without(each, [reason]) : each));
    return { ok: true, template: settle(template, slots, now) };
  }
  const item = template.text.find((each) => each.id === target.overlayId);
  if (!item || !has(item)) return missing;
  const next = {
    ...template,
    text: template.text.map((each) => (each.id === target.overlayId ? without(each, [reason]) : each)),
  };
  return { ok: true, template: settle(next, [...template.slots], now) };
}

/** BRK1-REV: the reel's sound credit to `audio.sound`; a credit answers `soundCreditMissing`, null clears it. */
export function setSoundCredit(template: Template, credit: SoundCredit | null, now: number): SlotEditResult {
  if (!credit)
    return {
      ok: true,
      template: settle({ ...template, audio: { ...template.audio, sound: null } }, [...template.slots], now),
    };
  const sound = {
    title: credit.title ?? null,
    artist: credit.artist ?? null,
    ...(credit.url ? { url: credit.url } : {}),
  };
  const doubts = (template.doubts ?? []).filter((d) => d.reason !== 'soundCreditMissing');
  return {
    ok: true,
    template: settle({ ...template, audio: { ...template.audio, sound } }, [...template.slots], now, {
      doubts,
    }),
  };
}

/** FRM1-MOT: the camera's move the person picked (null: "I don't know"); answers `motionUnsure`, keeps the measure. */
export function setMotion(
  template: Template,
  slotId: SlotId,
  motion: CameraMotion | null,
  now: number,
): SlotEditResult {
  if (!template.slots.some((slot) => slot.id === slotId)) return missingSlot();
  const slots = template.slots.map((slot) =>
    slot.id === slotId ? { ...without(slot, ['motionUnsure']), intent: { ...slot.intent, motion } } : slot,
  );
  return { ok: true, template: settle(template, slots, now) };
}
