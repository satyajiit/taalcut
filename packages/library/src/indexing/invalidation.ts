// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Dependent invalidation (round IX3, IX3-I3; library SPEC "Dependent invalidation"). In the transaction that
 * stores a stage's result or its skip, the pipeline takes a digest of what the stage now stores for the asset (its
 * definition's `stores`, read from the asset's view: SHA-256 of canonical JSON). When it differs from the digest the
 * row kept from the stage's last run, the stages that read this one go back to waiting for the asset; an unchanged
 * output marks nothing, so re-running a stage that stores the same thing twice invalidates nothing. A stage nobody
 * reads keeps no digest.
 *
 * A row with no digest (a library from before migration 27, or a stage that gained a reader since) records one and
 * invalidates nothing. `backfill` records the digests of what is stored without re-running anything; the pipeline
 * calls it for the assets it is about to reset for a version rise, so their first re-run compares with what they
 * stored, and for the rest of an old library while the queue is idle.
 *
 * An optional reader (LRN1-CTX, core `optionalReads`) runs without what it reads once that can't come (it failed, or
 * waits for its model): for it the first digest is a change too, so it runs again once the read lands. Only its rows
 * that have left `waiting` are reset; one still waiting reads the new output when it runs.
 *
 * A reader's job key carries the digests of what it reads, optional reads included (`inputsKey`): reset because an
 * input changed, it gets a new job rather than its earlier run's finished one.
 */
import type { AssetId, AssetIndexView, IndexStageDefinition } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { canonicalJson, sha256Hex } from '../stores/canonical';
import { createStageDigestRows, type StageDigestRows } from './stage-digest-rows';
import { optionalReadersOf, readersOf } from './stage-reads';
import { createStageRows } from './stage-rows';
import { buildAssetIndexView } from './view';

export interface Invalidation {
  /**
   * After `stage` stored its result or skip for the asset, inside that transaction: keeps the digest of what it
   * stores and, when it changed, resets the stages that read it. `view`: the asset as stored now, when the caller
   * has it (a skip stores nothing, so the view it was decided on is current). Returns how many rows were reset.
   */
  stored(assetId: AssetId, stage: string, view?: AssetIndexView): number;
  /** The part of `stage`'s job key that names what it reads: '' when it reads nothing registered. */
  inputsKey(assetId: AssetId, stage: string): string;
  /** Records the digests these assets' finished rows lack, from what is stored. Re-runs nothing. */
  backfill(assetIds: readonly AssetId[]): number;
  /** `backfill` for up to `limit` more assets that need it; 0 once none is left (then it stops looking). */
  backfillSome(limit?: number): number;
}

/** What the module's parts share: the digest rows and the stages whose digest matters, by name. */
interface Digests {
  readonly db: LibraryDatabase;
  readonly rows: StageDigestRows;
  /** Stages another registered stage reads (and that declare what they store): only theirs are kept. */
  readonly digested: ReadonlyMap<string, IndexStageDefinition>;
}

const digestOf = (definition: IndexStageDefinition, view: AssetIndexView) =>
  sha256Hex(canonicalJson(definition.stores?.(view) ?? null));

/** The asset as stored now (offline originals included: a digest needs no file). */
function viewOf(db: LibraryDatabase, assetId: AssetId): AssetIndexView | undefined {
  const outcome = buildAssetIndexView(db, assetId, { requirePresent: false });
  return outcome.kind === 'view' ? outcome.view : undefined;
}

/** Records the digests these assets' finished rows lack, one transaction per asset. Re-runs nothing. */
function backfill(ctx: Digests, assetIds: readonly AssetId[]): number {
  const byAsset = new Map<AssetId, string[]>();
  for (const { assetId, stage } of ctx.rows.missing(assetIds, [...ctx.digested.keys()]))
    byAsset.set(assetId, [...(byAsset.get(assetId) ?? []), stage]);
  let recorded = 0;
  for (const [assetId, stages] of byAsset) {
    const view = viewOf(ctx.db, assetId);
    if (!view) continue;
    const definitions = stages.flatMap((stage) => ctx.digested.get(stage) ?? []);
    ctx.db.transaction(() => {
      for (const definition of definitions)
        ctx.rows.set(assetId, definition.stage, digestOf(definition, view));
    });
    recorded += definitions.length;
  }
  return recorded;
}

/** `:<16 hex>` from the digests of the read stages that keep one, or '' when there are none. */
function inputsKey(ctx: Digests, assetId: AssetId, reads: readonly string[]): string {
  const kept = reads.filter((read) => ctx.digested.has(read));
  if (kept.length === 0) return '';
  const digests = ctx.rows.of(assetId, kept);
  return `:${sha256Hex(canonicalJson(kept.map((read) => [read, digests.get(read) ?? null]))).slice(0, 16)}`;
}

export function createInvalidation(deps: {
  readonly db: LibraryDatabase;
  readonly stages: readonly IndexStageDefinition[];
}): Invalidation {
  const { db } = deps;
  const stageRows = createStageRows(db);
  const readers = readersOf(deps.stages);
  const optionalReaders = optionalReadersOf(deps.stages);
  const byName = new Map(deps.stages.map((s) => [s.stage, s]));
  const read = (stage: string) => readers.has(stage) || optionalReaders.has(stage);
  const ctx: Digests = {
    db,
    rows: createStageDigestRows(db),
    digested: new Map(deps.stages.filter((s) => read(s.stage) && s.stores).map((s) => [s.stage, s])),
  };
  let backfilled = ctx.digested.size === 0;

  return {
    stored(assetId, stage, view) {
      const definition = ctx.digested.get(stage);
      const current = definition && (view ?? viewOf(db, assetId));
      if (!definition || !current) return 0;
      const digest = digestOf(definition, current);
      const previous = ctx.rows.of(assetId, [stage]).get(stage) ?? null;
      ctx.rows.set(assetId, stage, digest);
      if (previous === digest) return 0;
      // An optional reader may have run before this stage stored anything (it couldn't come then): the first
      // store counts as a change for it. A reader still waiting reads it when it runs.
      const late = stageRows.resetStarted(assetId, optionalReaders.get(stage) ?? []);
      if (previous === null) return late;
      return late + stageRows.reset([assetId], readers.get(stage) ?? []);
    },
    inputsKey: (assetId, stage) => {
      const definition = byName.get(stage);
      return inputsKey(ctx, assetId, [...(definition?.reads ?? []), ...(definition?.optionalReads ?? [])]);
    },
    backfill: (assetIds) => backfill(ctx, assetIds),
    backfillSome(limit = 32) {
      if (backfilled) return 0;
      const assetIds = ctx.rows.assetsMissing([...ctx.digested.keys()], limit);
      backfilled = assetIds.length === 0;
      return backfilled ? 0 : backfill(ctx, assetIds);
    },
  };
}
