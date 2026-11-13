// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stage graph, worked out once from the registered definitions before the pipeline runs anything: the order
 * every need comes before its dependants in, and what each stage waits for by asset kind (pipeline.ts schedules
 * by these plans).
 */
import type { AssetKind, IndexStageDefinition } from '@taalcut/core';
import type { OptionalReadPlan, StagePlan } from './stage-rows';

/** Definitions with every need before its dependants (a need that isn't registered is left out). */
export function orderStages(stages: readonly IndexStageDefinition[]): IndexStageDefinition[] {
  const byName = new Map(stages.map((s) => [s.stage, s]));
  if (byName.size !== stages.length) throw new Error('Two index stages share a name.');
  const done = new Set<string>();
  const out: IndexStageDefinition[] = [];
  const visit = (stage: IndexStageDefinition, path: string[]) => {
    if (done.has(stage.stage)) return;
    if (path.includes(stage.stage)) throw new Error(`Index stages need each other: ${path.join(' → ')}.`);
    for (const need of stage.needs) {
      const def = byName.get(need);
      if (def) visit(def, [...path, stage.stage]);
    }
    done.add(stage.stage);
    out.push(stage);
  };
  for (const stage of stages) visit(stage, []);
  return out;
}

/**
 * What scheduling needs of a definition. A need that doesn't apply to an asset's kind counts as met,
 * but its own needs still apply (an image skips vision.shots, yet vision.analyse still waits for
 * media.normalise); so each need is listed with the kinds it holds for. A need nobody registered is met.
 */
export function stagePlan(stage: IndexStageDefinition, all: readonly IndexStageDefinition[]): StagePlan {
  const byName = new Map(all.map((s) => [s.stage, s]));
  const effective = new Map<string, Set<AssetKind>>();
  const expand = (names: readonly string[], kinds: readonly AssetKind[], seen: Set<string>) => {
    for (const name of names) {
      const def = byName.get(name);
      if (!def || seen.has(name)) continue;
      const applies = kinds.filter((k) => def.appliesTo.includes(k));
      const passes = kinds.filter((k) => !def.appliesTo.includes(k));
      if (applies.length > 0) {
        const set = effective.get(name) ?? new Set<AssetKind>();
        applies.forEach((k) => set.add(k));
        effective.set(name, set);
      }
      if (passes.length > 0) expand(def.needs, passes, new Set([...seen, name]));
    }
  };
  expand(stage.needs, stage.appliesTo, new Set([stage.stage]));
  const needs = [...effective].map(([name, kinds]) => ({ stage: name, appliesTo: [...kinds] }));
  return {
    stage: stage.stage,
    appliesTo: stage.appliesTo,
    priority: stage.priority,
    needs,
    optionalReads: optionalReadPlans(stage, byName),
  };
}

/**
 * Each registered optional read that applies to one of the stage's kinds, with the stages whose failure or missing
 * model means it can't come now: it and everything it needs, transitively (LRN1-CTX). One nobody registered is met.
 */
function optionalReadPlans(
  stage: IndexStageDefinition,
  byName: ReadonlyMap<string, IndexStageDefinition>,
): OptionalReadPlan[] {
  return (stage.optionalReads ?? []).flatMap((name) => {
    const read = byName.get(name);
    const appliesTo = read ? stage.appliesTo.filter((kind) => read.appliesTo.includes(kind)) : [];
    if (!read || appliesTo.length === 0) return [];
    const blockers = new Set<string>();
    const visit = (names: readonly string[]) => {
      for (const next of names) {
        const def = byName.get(next);
        if (!def || blockers.has(next)) continue;
        blockers.add(next);
        visit(def.needs);
      }
    };
    visit([name]);
    return [{ stage: name, appliesTo, blockers: [...blockers] }];
  });
}
