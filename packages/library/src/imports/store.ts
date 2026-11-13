// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  captureGroupSchema,
  importDraftSchema,
  importItemOutcomeSchema,
  importItemSchema,
  importSessionSchema,
  type ImportDraft,
  type ImportDraftId,
  type ImportItemOutcome,
  type ImportSession,
  type ImportSessionId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { PreparedImportItem } from './adapter';

export function createImportStore(db: LibraryDatabase) {
  const parseDraft = (row: Record<string, unknown>) => importDraftSchema.parse(JSON.parse(String(row.body)));
  const parseSession = (row: Record<string, unknown>) =>
    importSessionSchema.parse(JSON.parse(String(row.body)));
  const draft = (id: ImportDraftId) => {
    const row = db.driver.prepare('SELECT body,private_data FROM import_drafts WHERE id=?').get(id);
    if (!row) return null;
    const saved = JSON.parse(String(row.private_data)) as { data?: unknown; captures?: unknown[] };
    return {
      draft: parseDraft(row),
      privateData: saved.data ?? null,
      captures: (saved.captures ?? []).map((value) => captureGroupSchema.parse(value)),
    };
  };
  const session = (id: ImportSessionId) => {
    const row = db.driver.prepare('SELECT body FROM import_sessions WHERE id=?').get(id);
    return row ? parseSession(row) : null;
  };
  const saveSession = (value: ImportSession) => {
    const checked = importSessionSchema.parse(value);
    db.driver
      .prepare(
        `INSERT INTO import_sessions(id,draft_id,method,status,body,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body`,
      )
      .run(
        checked.id,
        checked.draftId,
        checked.method,
        checked.status,
        JSON.stringify(checked),
        checked.createdAt,
      );
  };
  const saveDraft = (value: ImportDraft) => {
    db.driver
      .prepare('UPDATE import_drafts SET body=? WHERE id=?')
      .run(JSON.stringify(importDraftSchema.parse(value)), value.id);
  };
  const prepared = (id: ImportDraftId): PreparedImportItem[] =>
    db.driver
      .prepare('SELECT body,locator FROM import_draft_items WHERE draft_id=? ORDER BY ordinal')
      .all(id)
      .map((row) => ({
        item: importItemSchema.parse(JSON.parse(String(row.body))),
        locator: JSON.parse(String(row.locator)) as unknown,
      }));
  const outcomes = (id: ImportSessionId): ImportItemOutcome[] =>
    db.driver
      .prepare('SELECT body FROM import_session_items WHERE session_id=? ORDER BY ordinal')
      .all(id)
      .map((row) => importItemOutcomeSchema.parse(JSON.parse(String(row.body))));
  return {
    draft,
    session,
    saveSession,
    saveDraft,
    prepared,
    outcomes,
    transaction: <T>(work: () => T) => db.transaction(work),
    drafts: () =>
      db.driver
        .prepare(
          "SELECT body FROM import_drafts WHERE json_extract(body,'$.sessionId') IS NULL ORDER BY created_at DESC",
        )
        .all()
        .map(parseDraft),
    sessions: () =>
      db.driver
        .prepare('SELECT body FROM import_sessions ORDER BY created_at DESC,id DESC')
        .all()
        .map(parseSession),
    insertDraft(
      value: ImportDraft,
      items: readonly PreparedImportItem[],
      privateData: unknown,
      captures: readonly unknown[] = [],
    ) {
      db.transaction(() => {
        db.driver
          .prepare('INSERT INTO import_drafts VALUES(?,?,?,?)')
          .run(
            value.id,
            JSON.stringify(importDraftSchema.parse(value)),
            JSON.stringify({ data: privateData ?? null, captures }),
            value.createdAt,
          );
        const put = db.driver.prepare('INSERT INTO import_draft_items VALUES(?,?,?,?,?)');
        items.forEach((entry, index) =>
          put.run(
            value.id,
            entry.item.id,
            index,
            JSON.stringify(importItemSchema.parse(entry.item)),
            JSON.stringify(entry.locator ?? null),
          ),
        );
      });
    },
    checkpoint(id: ImportDraftId, privateData: unknown) {
      const saved = draft(id);
      if (saved)
        db.driver
          .prepare('UPDATE import_drafts SET private_data=? WHERE id=?')
          .run(JSON.stringify({ data: privateData, captures: saved.captures }), id);
    },
    discard(id: ImportDraftId) {
      db.driver.prepare('DELETE FROM import_drafts WHERE id=?').run(id);
    },
    putOutcome(sessionId: ImportSessionId, outcome: ImportItemOutcome, ordinal: number) {
      db.driver
        .prepare(
          `INSERT INTO import_session_items VALUES(?,?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET body=excluded.body`,
        )
        .run(sessionId, outcome.itemId, ordinal, JSON.stringify(importItemOutcomeSchema.parse(outcome)));
    },
  };
}
export type ImportStore = ReturnType<typeof createImportStore>;
