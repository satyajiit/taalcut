// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  parseId,
  unwrap,
  type ImportSession,
  type SourceId,
  type TransferFile,
  type TransferSession,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { ImportStore } from './store';
import { importCounts } from './selection';

const noControls = { pause: false, resume: false, cancel: false, retryFailed: false, byteResume: false };
const asSession = (id: string) => unwrap(parseId<'ImportSession'>(id));
export function createImportProjections(
  db: LibraryDatabase,
  store: ImportStore,
  changed: (immediate?: boolean) => void,
) {
  const sourceFor = (id: string) =>
    db.driver.prepare('SELECT id,display_name FROM sources WHERE transfer_session_id=?').get(id);
  function projectTransferSession(value: TransferSession) {
    const id = asSession(value.id);
    const prior = store.session(id);
    const source = sourceFor(value.id);
    const stopped = value.state === 'stopped';
    const outcomes = store.outcomes(id);
    const counts = importCounts(outcomes);
    const status = stopped
      ? value.totals.failed > 0
        ? 'partial'
        : value.totals.done < value.totals.files
          ? 'interrupted'
          : 'completed'
      : 'running';
    const session: ImportSession = {
      id,
      draftId: null,
      method: 'phone-wifi',
      sourceLabel:
        value.devices.map((device) => device.label).join(', ') ||
        String(source?.display_name ?? prior?.sourceLabel ?? 'Phone'),
      sourceId: source ? (source.id as SourceId) : (prior?.sourceId ?? null),
      status,
      stage: stopped ? 'checking' : 'receiving',
      progress: {
        totalItems: stopped ? value.totals.files : null,
        ...counts,
        receivedBytes: value.totals.bytesDone,
        totalBytes: stopped ? value.totals.bytes : null,
        bytesPerSecond: null,
        etaSeconds: null,
        currentFile: null,
      },
      capabilities: noControls,
      createdAt: value.startedAt,
      updatedAt: db.clock(),
      finishedAt: stopped ? db.clock() : null,
      safeToDisconnect: stopped && value.totals.done === value.totals.files,
    };
    store.saveSession(session);
    changed(stopped);
  }
  function projectTransferFile(file: TransferFile) {
    const id = asSession(file.sessionId);
    const prior = store.session(id);
    if (!prior) return;
    const source = sourceFor(file.sessionId);
    const sourceId = source ? (source.id as SourceId) : prior.sourceId;
    const result =
      file.assetId && sourceId ? { kind: 'asset' as const, assetId: file.assetId, sourceId } : null;
    const state =
      file.state === 'uploading' || file.state === 'paused'
        ? 'receiving'
        : file.state === 'importing'
          ? 'checking'
          : file.state === 'rejected'
            ? 'failed'
            : file.state;
    store.putOutcome(
      id,
      {
        itemId: file.id,
        name: file.name,
        state,
        receivedBytes: file.receivedBytes,
        result,
        error: file.error ?? null,
      },
      store.outcomes(id).length,
    );
    const outcomes = store.outcomes(id);
    store.saveSession({
      ...prior,
      sourceId,
      updatedAt: file.updatedAt,
      progress: {
        ...prior.progress,
        ...importCounts(outcomes),
        receivedBytes: outcomes.reduce((sum, item) => sum + item.receivedBytes, 0),
        currentFile: ['receiving', 'checking'].includes(state) ? file.name : null,
        bytesPerSecond: file.bytesPerSecond ?? null,
        etaSeconds: file.etaMs === undefined ? null : file.etaMs / 1000,
      },
    });
    changed(['imported', 'duplicate', 'failed', 'cancelled'].includes(state));
  }
  function backfill() {
    const rows = db.driver
      .prepare(
        "SELECT id,kind,display_name,transfer_session_id,created_at FROM sources WHERE kind IN ('wifi_import','usb_import') AND transfer_session_id IS NOT NULL",
      )
      .all();
    for (const row of rows) {
      const id = asSession(String(row.transfer_session_id));
      if (store.session(id)) continue;
      const count = Number(
        db.driver
          .prepare('SELECT COUNT(DISTINCT asset_id) AS n FROM library_asset_sources WHERE source_id=?')
          .get(String(row.id))?.n ?? 0,
      );
      store.saveSession({
        id,
        draftId: null,
        method: row.kind === 'wifi_import' ? 'phone-wifi' : 'phone-cable',
        sourceLabel: String(row.display_name),
        sourceId: row.id as SourceId,
        status: 'completed',
        stage: 'checking',
        progress: {
          totalItems: null,
          completedItems: count,
          failedItems: 0,
          skippedItems: 0,
          archivedItems: 0,
          receivedBytes: 0,
          totalBytes: null,
          bytesPerSecond: null,
          etaSeconds: null,
          currentFile: null,
        },
        capabilities: noControls,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.created_at),
        finishedAt: null,
        safeToDisconnect: false,
      });
    }
  }
  return { projectTransferSession, projectTransferFile, backfill };
}

/** Milestones come from existing indexing rows, never from the copy finishing. */
export function projectImportMilestones(
  db: LibraryDatabase,
  store: ImportStore,
  session: ImportSession,
): ImportSession {
  if (session.status === 'running' || session.status === 'paused' || session.status === 'interrupted')
    return session;
  const assetIds = store
    .outcomes(session.id)
    .flatMap((item) => (item.result?.kind === 'asset' ? [item.result.assetId] : []));
  if (assetIds.length === 0) return session;
  const rows = db.driver
    .prepare(
      `SELECT a.id,a.kind,s.searchable_at,s.complete_at,
    EXISTS(SELECT 1 FROM asset_index_stages p WHERE p.asset_id=a.id AND p.stage='media.proxy' AND p.state='done') AS playable
    FROM assets a LEFT JOIN asset_index_state s ON s.asset_id=a.id WHERE a.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(assetIds));
  if (rows.length !== new Set(assetIds).size) return session;
  const stage = rows.every((row) => row.complete_at !== null)
    ? 'analysed'
    : rows.every((row) => row.searchable_at !== null)
      ? 'searchable'
      : rows.every((row) => row.kind === 'image' || row.playable === 1)
        ? 'available'
        : 'checking';
  return { ...session, stage };
}
