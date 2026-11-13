// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stage that waits for its model because one of its jobs said the model is missing (UX1-IMPORT; the rows are
 * held, model-missing.ts). The desktop's `notReady` names the embedding stages' model up front; this catches every
 * other stage whose job finds out for itself (audio's language and transcript stages check whisper per job).
 *
 * While a stage has held rows nothing else of it is fed, so a 5,000-clip import doesn't fail each clip once a
 * poll; its other waiting rows say why (the model reason). One held row is tried again every `probeMs` (one job
 * per stage, never two at once). When that probe's row comes back done, the model is there and every held row of
 * the stage is released. Try again (`indexing.retryFailed`) releases them at once. A row an older build marked
 * failed for a missing model is held instead the next time the pipeline reconciles. An install (`wake`, UX2-MODELS)
 * makes every held stage's probe due at once: the model it waits for may be the one that just arrived.
 */
import type { AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { HELD, MODEL_MISSING_REASON } from './model-missing';
import type { RunnableStage, StagePlan, StageRows } from './stage-rows';

/** How often a stage that waits for its model tries one held row again. */
export const PROBE_MS = 5 * 60_000;

export function createModelWait(db: LibraryDatabase, rows: StageRows, probeMs = PROBE_MS) {
  /** The asset each stage's probe is running for, in this process. */
  const probing = new Map<string, AssetId>();
  /** Bumped by every install; a held stage whose last probe came before the latest one probes once more now. */
  let installs = 0;
  const probedAt = new Map<string, number>();
  const get = (text: string, ...params: (string | number)[]) =>
    db.driver.prepare(text).get(...params) as Record<string, unknown> | undefined;

  /** When the stage's newest held row was written, or null when it has none. */
  function heldSince(stage: string): number | null {
    const row = get(
      `SELECT MAX(x.updated_at) AS at FROM asset_index_stages x WHERE x.stage = ? AND ${HELD}`,
      stage,
      MODEL_MISSING_REASON,
    );
    return typeof row?.at === 'number' ? row.at : null;
  }

  return {
    /**
     * For the feed: undefined when the stage isn't waiting for its model (feed it as usual); otherwise the one
     * held row to try now, or null (wait). Marks the probe as running.
     */
    feed(plan: StagePlan, now: number): RunnableStage | null | undefined {
      const since = heldSince(plan.stage);
      if (since === null) return undefined;
      rows.markBlocked(plan.stage, MODEL_MISSING_REASON);
      const running = probing.get(plan.stage);
      if (running !== undefined) {
        const state = rows.get(running, plan.stage)?.state;
        if (state === 'queued' || state === 'running') return null;
        // It never reached the queue (skipped when fed, or the asset went): no job will report back.
        probing.delete(plan.stage);
      }
      const woken = (probedAt.get(plan.stage) ?? 0) < installs;
      if (now - since < probeMs && !woken) return null;
      const [probe] = rows.runnable(plan, 1, true);
      if (!probe) return null;
      probing.set(plan.stage, probe.assetId);
      probedAt.set(plan.stage, installs);
      return probe;
    },

    /** A row's job settled: when it was the stage's probe and its row is done, the model is there. */
    settled(assetId: AssetId, stage: string): void {
      if (probing.get(stage) !== assetId) return;
      probing.delete(stage);
      if (rows.get(assetId, stage)?.state === 'done') release(stage);
    },

    /** A model or runtime was just installed: every held stage tries one row on its next feed. */
    wake(): void {
      installs++;
    },

    /** Rows an older build marked failed for a missing model, held instead. Returns how many. */
    heal(): number {
      return db.driver
        .prepare(
          `UPDATE asset_index_stages AS x SET state = 'waiting', job_id = NULL, reason_key = ?, updated_at = ?
           WHERE x.state = 'failed' AND x.error IS NOT NULL
             AND json_extract(x.error, '$.code') GLOB '*.model_missing'`,
        )
        .run(MODEL_MISSING_REASON, db.clock()).changes;
    },
  };

  /** Every row of the stage that waits for its model, back to plain waiting. */
  function release(stage: string): number {
    return db.driver
      .prepare(
        `UPDATE asset_index_stages AS x SET reason_key = NULL, error = NULL, updated_at = ?
         WHERE x.stage = ? AND x.state = 'waiting' AND x.reason_key = ?`,
      )
      .run(db.clock(), stage, MODEL_MISSING_REASON).changes;
  }
}

export type ModelWait = ReturnType<typeof createModelWait>;
