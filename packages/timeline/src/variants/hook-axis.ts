// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hook axis (P3-V3): each variant opens on a shot the base and no earlier variant opened on, and differs from
 * all of them in at least ⌈30% × slots⌉ picks. The casting engine's `hookVariants` chooses the swaps (the hook
 * window's slots first); `applyCast` makes them on the draft, so trims, text, music and captions stay. Clips the
 * user locked or picked keep their shot; a locked or empty hook means this axis makes nothing.
 */
import {
  HOOK_WINDOW_SECONDS,
  ok,
  type AsyncResult,
  type CastCandidate,
  type MediaRef,
  type SlotId,
  type Timeline,
} from '@taalcut/core';
import { castingFitCap } from '../casting/alternates';
import type { CastVariant } from '../casting/result';
import type { LockedShot } from '../casting/template-pools';
import { applyCast } from '../edits/swap';
import { candidateKey, clipShot } from '../model/cast';
import { positions, videoItems } from '../model/sequence';
import { shownBySlot } from '../model/slot-shots';
import type { AxisInput, VariantAxis, VariantContext } from './axis';

type Locked = LockedShot;

interface BaseCast {
  readonly shots: {
    readonly slotId: SlotId;
    readonly assetId: Locked['assetId'];
    readonly shotId: Locked['shotId'];
  }[];
  readonly locked: Locked[];
  readonly hookSlotIds: SlotId[];
}

/** What the base shows per slot, the shots the user chose, and the slots that start in the hook window. */
function baseCast(base: Timeline): BaseCast {
  const rate = base.canvas.rate;
  const picked = new Set(
    (base.cast?.slots ?? []).flatMap((slot) => (slot.note === 'userPick' ? [slot.slotId] : [])),
  );
  const out: BaseCast = { shots: [], locked: [], hookSlotIds: [] };
  for (const { item, start } of positions(videoItems(base))) {
    if (!item.slotId) continue;
    // Starts before HOOK_WINDOW_SECONDS: start / (num / den) < seconds, in integers.
    if (start * rate.den < HOOK_WINDOW_SECONDS * rate.num) out.hookSlotIds.push(item.slotId);
    const shown = item.type === 'clip' ? clipShot(item) : null;
    if (item.type !== 'clip' || !shown) continue;
    const shot = { slotId: item.slotId, ...shown };
    out.shots.push(shot);
    if (item.locked || picked.has(item.slotId)) out.locked.push({ ...shot, sourceStart: item.sourceStart });
  }
  return out;
}

const mediaKey = (ref: MediaRef) =>
  candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null });

/** The slots whose pick differs from what the base shows there. */
function changedPicks(variant: CastVariant, shown: ReadonlyMap<string, string | null>) {
  return variant.slots.flatMap((slot): { slotId: SlotId; pick: CastCandidate }[] =>
    slot.pick && shown.has(slot.slotId) && candidateKey(slot.pick) !== shown.get(slot.slotId)
      ? [{ slotId: slot.slotId, pick: slot.pick }]
      : [],
  );
}

async function vary({ base, drafts }: AxisInput, context: VariantContext): AsyncResult<Timeline[]> {
  // Story mode, or a video made without a cast: no template slots to re-cast.
  if (!base.template || !base.cast) return ok([]);
  const template = await context.templates.read(base.template);
  if (!template.ok) return template;
  const cast = baseCast(base);
  const cut = await context.engine.hookVariants(
    {
      template: template.value,
      base: cast.shots,
      locked: cast.locked,
      hookSlotIds: cast.hookSlotIds,
      count: drafts.length,
      canvas: base.canvas,
    },
    context.signal,
  );
  if (!cut.ok) return cut;
  const shown = shownBySlot(base);
  const hookSlot = template.value.slots[0]?.id;
  const out: Timeline[] = [];
  for (const [index, variant] of cut.value.entries()) {
    const draft = drafts[index];
    const hook = variant.slots.find((slot) => slot.slotId === hookSlot)?.pick;
    // A hook the engine couldn't change (locked, a gap, or no other shot fits): not a hook variant.
    if (!draft || !hook || !hookSlot || candidateKey(hook) === shown.get(hookSlot)) break;
    const applied = applyCast(draft, changedPicks(variant, shown), {
      source: 'agent',
      media: new Map(variant.media.map((ref) => [mediaKey(ref), ref])),
      tau: context.engine.config.confidence.tau,
      fitCap: castingFitCap(context.engine.config),
      ids: context.ids,
      ...(context.config ? { config: context.config } : {}),
    });
    if (!applied.ok) return applied;
    out.push(applied.value.timeline);
  }
  return ok(out);
}

export const hookAxis: VariantAxis = { id: 'hook', vary };
