// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timelines.planEnergyCurve, as @taalcut/timeline's planEnergyCurve answers it (P3-V12, reads only): the
 * timeline's template version re-split by the curve, and a pick for each changed slot nobody locked. Casting
 * here is the fake's pool: fresh candidates (findAlternates) long enough for the new slot, best first, each
 * starting in the middle of its shot. The new slots' ids come from the template version and the curve, so the
 * plan, the command and its redo name the same slots.
 */
import {
  err,
  ok,
  RationalTime,
  type CastCandidate,
  type EnergyCurve,
  type EnergyCurvePlan,
  type EnergySlotMap,
  type Result,
  type SlotId,
  type Template,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import {
  cutsOf,
  splitOnCurve,
  type EnergyIds,
  type EnergySplit,
} from '../../../../../features/timeline/energy/energy-split';
import { fakeUlid } from '../../../library/seed';
import { TEMPLATE_KIND } from '../../../templates/template-data';
import { timelineError } from '../../edits';
import { centredStart } from '../../shot-pool';
import type { MakeP3Deps } from '../deps';

/** A deterministic id per new slot: the template version and the curve name them (the real derives them alike). */
export function energySlotIds(template: Template, curve: EnergyCurve): EnergyIds {
  const text = `${template.id}:${template.version}:${JSON.stringify(curve.sections)}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let n = 0;
  return {
    slot: () => fakeUlid<'TemplateSlot'>(TEMPLATE_KIND.slot, 1e12 + (hash % 1e9) * 1000 + (n += 1)) as SlotId,
  };
}

export interface CurveOnTimeline extends EnergySplit {
  /** The version the timeline was made from. */
  readonly base: Template;
}

/** The timeline's template version re-split by `curve`. */
export async function curveOnTimeline(
  deps: Pick<MakeP3Deps, 'templates'>,
  timeline: Timeline,
  curve: EnergyCurve,
): Promise<Result<CurveOnTimeline>> {
  const ref = timeline.template;
  if (!ref) return err(timelineError('timeline.template_not_found', { templateId: 'none' }));
  const found = await deps.templates.get(ref.id, ref.version);
  if (!found) return err(timelineError('timeline.template_not_found', { templateId: ref.id }));
  const split = splitOnCurve(found.template, curve, energySlotIds(found.template, curve));
  return split.ok ? ok({ ...split.value, base: found.template }) : split;
}

/** The new slots casting must leave alone: unchanged ones, and the first new slot of a locked clip's span. */
export function fixedSlots(timeline: Timeline, slotMap: EnergySlotMap): Set<string> {
  const out = new Set<string>();
  for (const item of timeline.tracks[0]?.kind === 'video' ? timeline.tracks[0].items : []) {
    if (item.type !== 'clip' || !item.slotId) continue;
    const slotId: string = item.slotId;
    const entry = slotMap.find((candidate) => (candidate.from as readonly string[]).includes(slotId));
    if (entry && (entry.unchanged || item.locked)) out.add(entry.slotId);
  }
  return out;
}

/** Picks for the changed slots from the pool: no shot twice, each long enough for its new slot. */
function castChanged(
  deps: Pick<MakeP3Deps, 'timelines' | 'shots'>,
  timeline: Timeline,
  split: EnergySplit,
  wanted: readonly SlotId[],
): { slotId: SlotId; pick: CastCandidate }[] {
  const first = wanted[0];
  if (!first) return [];
  const rate = timeline.canvas.rate;
  const pool = deps.timelines.findAlternates({
    timelineId: timeline.id,
    slotId: first,
    exclude: [],
    limit: 24,
  });
  const used = new Set<string>();
  return wanted.flatMap((slotId) => {
    const slot = split.template.slots.find((each) => each.id === slotId);
    if (!slot) return [];
    const frames = RationalTime.toFrames(slot.duration, rate);
    for (const candidate of pool) {
      const key = candidate.shotId ?? candidate.assetId;
      const shot = deps.shots.get(key);
      if (used.has(key) || !shot) continue;
      if (RationalTime.toSeconds(shot.shot.duration) < frames / (rate.num / rate.den)) continue;
      used.add(key);
      return [{ slotId, pick: { ...candidate, sourceStart: centredStart(shot, frames, rate) } }];
    }
    return [];
  });
}

export async function planEnergyCurve(
  deps: Pick<MakeP3Deps, 'timelines' | 'shots' | 'templates'>,
  timelineId: TimelineId,
  curve: EnergyCurve,
): Promise<Result<EnergyCurvePlan>> {
  const timeline = deps.timelines.get(timelineId);
  if (!timeline) return err(timelineError('timeline.not_found', { timelineId }));
  const split = await curveOnTimeline(deps, timeline, curve);
  if (!split.ok) return split;
  const { slotMap, template, base } = split.value;
  const changed = slotMap.filter((entry) => !entry.unchanged).map((entry) => entry.slotId);
  const fixed = fixedSlots(timeline, slotMap);
  const picks = castChanged(
    deps,
    timeline,
    split.value,
    changed.filter((slotId) => !fixed.has(slotId)),
  );
  return ok({
    templateBaseVersion: base.version,
    slotMap,
    changedSlots: changed.length,
    picks,
    cuts: cutsOf(template),
  });
}
