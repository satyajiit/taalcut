// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timelines.planEnergyCurve` (P3-V12, reads only): the timeline's template version re-split by the curve, and a
 * pick for every changed slot from the casting engine with every unchanged slot's shot locked as a neighbour (and
 * so excluded from the changed ones) and the user's locked clips kept on the first new slot of their span. The
 * editor previews it (ghost cuts, "re-casts 4 slots") and `timeline.applyEnergyCurve` applies it.
 */
import {
  err,
  ok,
  type AsyncResult,
  type EnergyCurve,
  type EnergyCurvePlan,
  type EnergySlotMap,
  type SlotCast,
  type Template,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { CastingEngine } from '../casting/engine';
import type { LockedShot } from '../casting/template-pools';
import { NoCandidates, TemplateNotFound } from '../errors';
import { videoItems } from '../model/sequence';
import type { EnergyDeps } from './energy-deps';
import { energySlotIds } from '../model/derived-ids';

export interface CurveOnTimeline {
  /** The version the timeline was made from. */
  readonly base: Template;
  /** Re-split by the curve; still numbered as `base` until the template service stores it. */
  readonly template: Template;
  readonly slotMap: EnergySlotMap;
}

/** The timeline's template version re-split by `curve`, with the slot ids every run of it agrees on. */
export async function curveOnTimeline(
  timeline: Timeline,
  curve: EnergyCurve,
  energy: Pick<EnergyDeps, 'applyCurve' | 'reader'>,
): AsyncResult<CurveOnTimeline> {
  const ref = timeline.template;
  if (!ref) return err(TemplateNotFound({ templateId: 'none' }));
  const base = await energy.reader.read({ id: ref.id, version: ref.version });
  if (!base.ok) return base;
  const applied = energy.applyCurve(base.value, curve, energySlotIds(base.value, curve));
  if (!applied.ok) return applied;
  return ok({ base: base.value, template: applied.value.template, slotMap: applied.value.slotMap });
}

/** The shots casting must keep: unchanged slots' clips, and locked clips on the first new slot of their span. */
export function fixedShots(timeline: Timeline, slotMap: EnergySlotMap): LockedShot[] {
  const out = new Map<string, LockedShot>();
  for (const item of videoItems(timeline)) {
    if (item.type !== 'clip' || !item.slotId || item.media.kind === 'audio') continue;
    const slotId: string = item.slotId;
    const entry = slotMap.find((candidate) => (candidate.from as readonly string[]).includes(slotId));
    if (!entry || out.has(entry.slotId)) continue;
    if (!entry.unchanged && !item.locked) continue;
    out.set(entry.slotId, {
      slotId: entry.slotId,
      assetId: item.media.assetId,
      shotId: item.media.kind === 'video' ? item.media.shotId : null,
      sourceStart: item.sourceStart,
    });
  }
  return [...out.values()];
}

export interface EnergyReadDeps {
  readonly read: (timelineId: TimelineId) => AsyncResult<Timeline>;
  readonly energy: Pick<EnergyDeps, 'applyCurve' | 'reader'>;
  readonly engine: CastingEngine;
}

/** Casting's slots for the re-split template, every fixed shot kept; none when the library has nothing to offer. */
async function castSplit(
  timeline: Timeline,
  template: Template,
  locked: readonly LockedShot[],
  engine: CastingEngine,
): AsyncResult<readonly SlotCast[]> {
  const cast = await engine.cast({
    projectId: timeline.projectId,
    template,
    mode: 'template',
    variants: 1,
    seed: 0,
    locked,
  });
  if (cast.ok) return ok(cast.value.variants[0]?.slots ?? []);
  return NoCandidates.is(cast.error) ? ok([]) : cast;
}

/** The plan for `curve` on the timeline: the re-split, and a pick for each changed slot nobody locked. */
export async function planEnergyCurve(
  deps: EnergyReadDeps,
  timelineId: TimelineId,
  curve: EnergyCurve,
): AsyncResult<EnergyCurvePlan> {
  const timeline = await deps.read(timelineId);
  if (!timeline.ok) return timeline;
  const split = await curveOnTimeline(timeline.value, curve, deps.energy);
  if (!split.ok) return split;
  const { template, slotMap } = split.value;
  const changed = new Set<string>(slotMap.flatMap((entry) => (entry.unchanged ? [] : [entry.slotId])));
  const locked = fixedShots(timeline.value, slotMap);
  const lockedSlots = new Set<string>(locked.map((lock) => lock.slotId));
  const slots = await castSplit(timeline.value, template, locked, deps.engine);
  if (!slots.ok) return slots;
  const picks = slots.value.flatMap((slot) =>
    slot.pick && changed.has(slot.slotId) && !lockedSlots.has(slot.slotId)
      ? [{ slotId: slot.slotId, pick: slot.pick }]
      : [],
  );
  const cuts = [...template.slots.map((slot) => slot.start.value), template.duration.value];
  return ok({
    templateBaseVersion: split.value.base.version,
    slotMap,
    changedSlots: changed.size,
    picks,
    cuts,
  });
}

export function createEnergyReads(deps: EnergyReadDeps) {
  return {
    planEnergyCurve: (timelineId: TimelineId, curve: EnergyCurve) => planEnergyCurve(deps, timelineId, curve),
  };
}
