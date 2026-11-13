// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { PULL_STATES, type PullState } from '../github/github-port';
import { type D1Database } from './d1';

/** A submission and its pull request's last known state. Hidden is not stored: it is the hub repository's list. */
export interface SubmissionRow {
  id: string;
  hub_id: string;
  owner: string;
  sha256: string;
  version: number;
  pull_request: number;
  state: PullState;
  created_at: number;
}

const COLUMNS = 'id, hub_id, owner, sha256, version, pull_request, state, created_at';
const BY_HASH = `SELECT ${COLUMNS} FROM submissions WHERE owner = ? AND sha256 = ?`;
const BY_ID = `SELECT ${COLUMNS} FROM submissions WHERE id = ?`;
const MAX_VERSION = 'SELECT MAX(version) AS version FROM submissions WHERE hub_id = ? AND owner = ?';
const INSERT =
  'INSERT INTO submissions (id, hub_id, owner, sha256, version, pull_request, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const SET_STATE = 'UPDATE submissions SET state = ? WHERE id = ?';
const OPEN = "SELECT id, pull_request FROM submissions WHERE hub_id = ? AND state = 'open'";

const submissionRow = z.object({
  id: z.string(),
  hub_id: z.string(),
  owner: z.string(),
  sha256: z.string(),
  version: z.number().int().positive(),
  pull_request: z.number().int().positive(),
  state: z.enum(PULL_STATES),
  created_at: z.number().int().nonnegative(),
});
const versionRow = z.object({ version: z.number().int().positive().nullable() });
const openRow = submissionRow.pick({ id: true, pull_request: true });

async function one(db: D1Database, query: string, ...values: string[]): Promise<SubmissionRow | null> {
  const row = await db
    .prepare(query)
    .bind(...values)
    .first();
  return row === null ? null : submissionRow.parse(row);
}

export function findByOwnerHash(
  db: D1Database,
  owner: string,
  sha256: string,
): Promise<SubmissionRow | null> {
  return one(db, BY_HASH, owner, sha256);
}

export function findById(db: D1Database, id: string): Promise<SubmissionRow | null> {
  return one(db, BY_ID, id);
}

export async function maxVersion(db: D1Database, hubId: string, owner: string): Promise<number | null> {
  return versionRow.parse(await db.prepare(MAX_VERSION).bind(hubId, owner).first()).version;
}

export async function insertSubmission(db: D1Database, row: SubmissionRow): Promise<void> {
  await db
    .prepare(INSERT)
    .bind(row.id, row.hub_id, row.owner, row.sha256, row.version, row.pull_request, row.state, row.created_at)
    .run();
}

export async function setSubmissionState(db: D1Database, id: string, state: PullState): Promise<void> {
  await db.prepare(SET_STATE).bind(state, id).run();
}

export async function openSubmissions(
  db: D1Database,
  hubId: string,
): Promise<{ id: string; pull_request: number }[]> {
  const rows = await db.prepare(OPEN).bind(hubId).all();
  return rows.results.map((row) => openRow.parse(row));
}
