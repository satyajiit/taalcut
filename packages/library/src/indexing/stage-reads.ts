// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which stages read which (round IX3, dependent invalidation), from each definition's own `reads` and
 * `optionalReads` (LRN1-CTX): there is no central table. A read names a stage whose stored output the reader uses;
 * when that stage stores something else, the pipeline runs the reader again (invalidation.ts). A read nobody
 * registered is left out, like a need.
 */
import { indexStageMilestone, type IndexStageDefinition } from '@taalcut/core';

/** For each registered stage, the registered stages that list it in `pick` (their reads), in the order given. */
function readersBy(
  stages: readonly IndexStageDefinition[],
  pick: (stage: IndexStageDefinition) => readonly string[] | undefined,
): Map<string, string[]> {
  const names = new Set(stages.map((s) => s.stage));
  const readers = new Map<string, string[]>();
  for (const stage of stages)
    for (const read of pick(stage) ?? [])
      if (names.has(read)) readers.set(read, [...(readers.get(read) ?? []), stage.stage]);
  return readers;
}

/** For each registered stage, the registered stages that read it, in the order given. */
export function readersOf(stages: readonly IndexStageDefinition[]): Map<string, string[]> {
  return readersBy(stages, (stage) => stage.reads);
}

/** For each registered stage, the registered stages that read it optionally (LRN1-CTX), in the order given. */
export function optionalReadersOf(stages: readonly IndexStageDefinition[]): Map<string, string[]> {
  return readersBy(stages, (stage) => stage.optionalReads);
}

/** Every stage `stage` waits for: its needs, their needs, and so on (registered ones only). */
function upstream(
  stage: IndexStageDefinition,
  byName: ReadonlyMap<string, IndexStageDefinition>,
): Set<string> {
  const found = new Set<string>();
  const visit = (names: readonly string[]) => {
    for (const name of names) {
      const def = byName.get(name);
      if (!def || found.has(name)) continue;
      found.add(name);
      visit(def.needs);
    }
  };
  visit(stage.needs);
  return found;
}

/**
 * Throws on reads the pipeline can't honour (a bug in the stage list, like a cycle of needs): a read that isn't
 * among the stages the reader waits for (it could run before what it reads is stored), a stage another one reads
 * (optionally or not) that says nothing of what it `stores` (there would be nothing to compare), or a searchable
 * stage that reads a complete-only stage optionally (it waits for it while it is coming, which would hold the
 * searchable milestone behind a complete one, as core's checkIndexStageMilestones forbids for needs).
 */
export function checkStageReads(stages: readonly IndexStageDefinition[]): void {
  const byName = new Map(stages.map((s) => [s.stage, s]));
  for (const stage of stages) {
    const waits = upstream(stage, byName);
    const reads = [
      ...(stage.reads ?? []).map((name) => ({ name, optional: false })),
      ...(stage.optionalReads ?? []).map((name) => ({ name, optional: true })),
    ];
    for (const { name, optional } of reads) {
      const read = byName.get(name);
      const problem = read && readProblem(stage, read, optional, waits);
      if (problem) throw new Error(problem);
    }
  }
}

/** What is wrong with `stage` reading `read` (optionally or not), given the stages it waits for; undefined: nothing. */
function readProblem(
  stage: IndexStageDefinition,
  read: IndexStageDefinition,
  optional: boolean,
  waits: ReadonlySet<string>,
): string | undefined {
  if (!optional && !waits.has(read.stage))
    return `Index stage '${stage.stage}' reads '${read.stage}' without waiting for it (a need).`;
  if (!read.stores)
    return `Index stage '${read.stage}' is read by '${stage.stage}' but declares nothing it stores.`;
  if (optional && indexStageMilestone(stage) === 'searchable' && indexStageMilestone(read) !== 'searchable')
    return `Searchable index stage '${stage.stage}' reads '${read.stage}', which counts toward complete only.`;
  return undefined;
}
