// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { type D1Database } from './d1';

const FIRST = 'SELECT issue FROM reports WHERE hub_id = ? ORDER BY at ASC LIMIT 1';
const INSERT = 'INSERT INTO reports (id, hub_id, reporter, reason, issue, at) VALUES (?, ?, ?, ?, ?, ?)';

const issueRow = z.object({ issue: z.number().int().positive() });

/** The moderation issue the first report on this template opened, if any. */
export async function firstIssue(db: D1Database, hubId: string): Promise<number | null> {
  const row = await db.prepare(FIRST).bind(hubId).first();
  return row === null ? null : issueRow.parse(row).issue;
}

export async function insertReport(
  db: D1Database,
  row: { id: string; hubId: string; reporter: string; reason: string; issue: number; at: number },
): Promise<void> {
  await db.prepare(INSERT).bind(row.id, row.hubId, row.reporter, row.reason, row.issue, row.at).run();
}
