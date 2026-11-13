// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two finish lines (IX design C), per asset and overall, in ms from Add folder (IX-B2):
 *
 * - **Searchable**: every searchable stage that applies to the asset (has a row for it) is done or skipped; the
 *   moment is the last of those stages' finishes. The searchable stages are the ones the run's pipeline marks
 *   `milestone: 'searchable'`; until stages declare it, design C's set: library.hash, media.normalise, the
 *   thumbnail (its own stage once it exists, else media.previews, which makes it today), vision.shots,
 *   vision.analyse, audio.language, audio.transcript, vision.embed and vision.embedText. Once the ready lane
 *   stores `searchable_at`, it is read too and reported beside the computed value.
 * - **Complete**: every stage row of the asset is done or skipped; the last finish (the e2e's "no stage row is
 *   active"). A description held for the model that describes (LIB1-FIX: the bench's seed has none; before, the
 *   stage stored `not_yet` at once) is left out and counted in `heldForModel`, which the bench reports beside it.
 *
 * An asset with a stage that never settled (failed, or still active when the run ended) has neither.
 */
import type { PipelineGraph } from '../bench/run-record';
import { settledState, type StageSpan } from './spans';

export const DESIGN_C_SEARCHABLE = [
  'library.hash',
  'media.normalise',
  'vision.shots',
  'vision.analyse',
  'audio.language',
  'audio.transcript',
  'vision.embed',
  'vision.embedText',
] as const;

export interface SearchableRule {
  /** 'declared': the stages' own milestone; 'design-c': the set above, until stages declare one. */
  readonly source: 'declared' | 'design-c';
  readonly stages: readonly string[];
}

export function searchableRule(pipeline: PipelineGraph): SearchableRule {
  const declared = pipeline.stages
    .filter((stage) => stage.milestone === 'searchable')
    .map((stage) => stage.stage);
  if (declared.length > 0) return { source: 'declared', stages: declared };
  const names = new Set(pipeline.stages.map((stage) => stage.stage));
  const thumbnail = [...names].find((name) => /thumbnail/i.test(name)) ?? 'media.previews';
  return { source: 'design-c', stages: [...DESIGN_C_SEARCHABLE, thumbnail] };
}

/** A description waiting for the model that describes (library.stage.modelMissing): it runs once that is installed. */
export function heldForModel(span: StageSpan): boolean {
  return (
    span.stage === 'vision.describe' &&
    span.state === 'waiting' &&
    span.reason === 'library.stage.modelMissing'
  );
}

export interface AssetMilestones {
  readonly assetId: string;
  readonly file: string;
  readonly assetKind: string;
  readonly searchableMs: number | null;
  /** The ready lane's stored value (ms from Add folder), when the library has one. */
  readonly storedSearchableMs: number | null;
  readonly completeMs: number | null;
  /** The ready lane's stored `complete_at` (ms from Add folder), when the library has one. */
  readonly storedCompleteMs: number | null;
  /** Description rows held for their model, left out of `completeMs` (the library stores no complete_at then). */
  readonly heldForModel: number;
  /** The searchable stage that finished last: what made the asset wait. */
  readonly searchableBy: string | null;
}

function lastSettled(spans: readonly StageSpan[]): { at: number; stage: string } | null {
  if (spans.some((span) => !settledState(span.state) || span.finishedMs === null)) return null;
  let last: { at: number; stage: string } | null = null;
  for (const span of spans)
    if (span.finishedMs !== null && (last === null || span.finishedMs > last.at))
      last = { at: span.finishedMs, stage: span.stage };
  return last;
}

export function assetMilestones(
  spans: readonly StageSpan[],
  rule: SearchableRule,
  stored: ReadonlyMap<string, number | null> | null,
  addedAt: number,
  storedComplete: ReadonlyMap<string, number | null> | null = null,
): AssetMilestones[] {
  const byAsset = new Map<string, StageSpan[]>();
  for (const span of spans) byAsset.set(span.assetId, [...(byAsset.get(span.assetId) ?? []), span]);
  const searchable = new Set(rule.stages);
  return [...byAsset.values()].map((rows) => {
    const first = rows[0];
    if (first === undefined) throw new Error('an asset without stage rows');
    const searchableLast = lastSettled(rows.filter((row) => searchable.has(row.stage)));
    const storedAt = stored?.get(first.assetId) ?? null;
    const completeAt = storedComplete?.get(first.assetId) ?? null;
    const counted = rows.filter((row) => !heldForModel(row));
    return {
      assetId: first.assetId,
      file: first.file,
      assetKind: first.assetKind,
      searchableMs: searchableLast?.at ?? null,
      storedSearchableMs: storedAt === null ? null : storedAt - addedAt,
      completeMs: lastSettled(counted)?.at ?? null,
      storedCompleteMs: completeAt === null ? null : completeAt - addedAt,
      heldForModel: rows.length - counted.length,
      searchableBy: searchableLast?.stage ?? null,
    };
  });
}

/** The library's finish line: the last asset's, or null while any asset never got there. */
export function overall(assets: readonly AssetMilestones[], pick: (asset: AssetMilestones) => number | null) {
  const values = assets.map(pick);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return Math.max(...values.filter((value): value is number => value !== null));
}
