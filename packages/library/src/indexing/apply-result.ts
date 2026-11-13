// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stores what a stage handed back (core's IndexStageResult) and marks the
 * stage done, in one transaction: a crash leaves either the stage's result and
 * its `done`, or neither (the stage reruns; its job is idempotent per input).
 * Each field replaces what the asset had for that part.
 */
import { ok, type AssetId, type IndexStageResult, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createRepositories } from '../repositories';
import { inTransaction } from '../repositories/shared';
import { storeSpokenLanguage } from '../speech/asset-language';
import { createStageRows } from './stage-rows';

export function applyStageResult(
  db: LibraryDatabase,
  assetId: AssetId,
  stage: string,
  generation: number,
  result: IndexStageResult,
  output: unknown,
  /** When the job finished (default now). */
  finishedAt?: number,
): Result<void> {
  const repos = createRepositories(db);
  const rows = createStageRows(db);
  return inTransaction(db, 'index_stage', () => {
    const steps: (() => Result<unknown>)[] = [];
    if (result.facts) steps.push(() => repos.assets.setFacts(assetId, result.facts!));
    if (result.derived) steps.push(() => repos.derivedFiles.put(assetId, result.derived!));
    if (result.shots) steps.push(() => repos.shots.replaceForAsset(assetId, generation, result.shots!));
    if (result.analyses) steps.push(() => repos.shots.putAnalyses(result.analyses!));
    if (result.descriptions) steps.push(() => repos.shots.putDescriptions(result.descriptions!));
    if (result.transcript !== undefined)
      steps.push(() => repos.transcripts.put(assetId, result.transcript!, generation));
    if (result.language) steps.push(() => repos.assets.setLanguage(assetId, result.language!));
    if (result.spokenLanguage)
      steps.push(() => storeSpokenLanguage(db, assetId, result.spokenLanguage!, repos.assets));
    if (result.beats) steps.push(() => repos.assets.setBeatMap(assetId, result.beats!));
    for (const step of steps) {
      const done = step();
      if (!done.ok) return done;
    }
    rows.done(assetId, stage, output, finishedAt);
    return ok(undefined);
  });
}
