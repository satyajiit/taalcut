// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { setTimeout as delay } from 'node:timers/promises';
import {
  CancelledError,
  err,
  importItemOutcomeSchema,
  importSessionSchema,
  ok,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type ImportSessionId,
} from '@taalcut/core';
import { createRepositories, type LibraryDatabase } from '@taalcut/library';

const IMPORT_LIMIT_MS = 2 * 60 * 60_000;
const pause = async (signal: AbortSignal): AsyncResult<void> => {
  try {
    await delay(500, undefined, { signal });
    return ok(undefined);
  } catch {
    return err(CancelledError());
  }
};

/** A cancelled import is terminal; its draft cannot be started again after an interrupted tool call. */
export function isShortsImportCancelled(db: LibraryDatabase, sessionId: ImportSessionId): boolean {
  const row = db.driver.prepare('SELECT body FROM import_sessions WHERE id=?').get(sessionId);
  if (!row) return false;
  const parsed = importSessionSchema.safeParse(JSON.parse(String(row.body)));
  return parsed.success && parsed.data.status === 'cancelled';
}

/** The main import service owns copying, duplicate handling and cancellation; the agent only reads its receipts. */
export async function awaitShortsImport(
  db: LibraryDatabase,
  sessionId: ImportSessionId,
  signal: AbortSignal,
): AsyncResult<AssetId> {
  const deadline = Date.now() + IMPORT_LIMIT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) return err(CancelledError());
    const row = db.driver.prepare('SELECT body FROM import_sessions WHERE id=?').get(sessionId);
    if (row) {
      const parsed = importSessionSchema.safeParse(JSON.parse(String(row.body)));
      if (!parsed.success) return err(ValidationError({ field: 'importSession' }));
      const session = parsed.data;
      if (['completed', 'partial', 'failed', 'cancelled'].includes(session.status)) {
        const outcomes = db.driver
          .prepare('SELECT body FROM import_session_items WHERE session_id=? ORDER BY ordinal')
          .all(sessionId);
        const assets: AssetId[] = [];
        for (const outcome of outcomes) {
          const item = importItemOutcomeSchema.safeParse(JSON.parse(String(outcome.body)));
          if (!item.success) return err(ValidationError({ field: 'importOutcome' }));
          if (item.data.result?.kind === 'asset') assets.push(item.data.result.assetId);
        }
        if (assets.length === 1 && ['completed', 'partial'].includes(session.status)) return ok(assets[0]!);
        return err(
          ValidationError({ field: 'shorts.import' }, { detail: `Source import ended ${session.status}` }),
        );
      }
      if (session.status === 'paused' || session.status === 'interrupted') {
        return err(
          ValidationError(
            { field: 'shorts.import' },
            { detail: `Source import is ${session.status}; resume it in Imports` },
          ),
        );
      }
    }
    const waited = await pause(signal);
    if (!waited.ok) return waited;
  }
  return err(
    ValidationError({ field: 'shorts.import' }, { detail: 'Source import did not finish within two hours' }),
  );
}

/** Fail incomplete speech rather than treating an untranscribed source as a silent visual story. */
export async function awaitShortsSourceReady(
  db: LibraryDatabase,
  assetId: AssetId,
  signal: AbortSignal,
): AsyncResult<void> {
  const deadline = Date.now() + IMPORT_LIMIT_MS;
  const repos = createRepositories(db);
  const stages = ['media.normalise', 'vision.shots', 'vision.analyse', 'vision.describe', 'audio.transcript'];
  while (Date.now() < deadline) {
    if (signal.aborted) return err(CancelledError());
    const asset = repos.assets.get(assetId);
    if (!asset.ok) return asset;
    if (asset.value.kind !== 'video' || asset.value.trashedAt) {
      return err(ValidationError({ field: 'assetId' }, { detail: 'A source must be an available video' }));
    }
    const rows = db.driver
      .prepare('SELECT stage,state,reason_key FROM asset_index_stages WHERE asset_id=?')
      .all(assetId);
    const required = stages.filter((stage) => stage !== 'audio.transcript' || asset.value.hasAudio !== false);
    const relevant = rows.filter((row) => required.includes(String(row.stage)));
    const failed = relevant.find(
      (row) => row.state === 'failed' || row.reason_key === 'indexing.skip.cannotTranscribe',
    );
    if (failed)
      return err(
        ValidationError(
          { field: 'shorts.indexing' },
          { detail: `Source analysis unavailable: ${String(failed.stage)}` },
        ),
      );
    if (
      asset.value.durationValue &&
      required.every((stage) =>
        relevant.some((row) => row.stage === stage && ['done', 'skipped'].includes(String(row.state))),
      )
    )
      return ok(undefined);
    const waited = await pause(signal);
    if (!waited.ok) return waited;
  }
  return err(
    ValidationError(
      { field: 'shorts.indexing' },
      { detail: 'Source indexing did not finish within two hours' },
    ),
  );
}
