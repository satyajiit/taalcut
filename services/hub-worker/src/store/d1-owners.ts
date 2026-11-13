// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { type D1Database } from './d1';

const SELECT_OWNER = 'SELECT owner FROM owners WHERE hub_id = ?';
const INSERT_OWNER = 'INSERT INTO owners (hub_id, owner) VALUES (?, ?) ON CONFLICT (hub_id) DO NOTHING';

const ownerRow = z.object({ owner: z.string() });

export async function ownerOf(db: D1Database, hubId: string): Promise<string | null> {
  const row = await db.prepare(SELECT_OWNER).bind(hubId).first();
  return row === null ? null : ownerRow.parse(row).owner;
}

/** First writer wins. Returns the stored owner, which may be someone else. */
export async function claimOwner(db: D1Database, hubId: string, owner: string): Promise<string> {
  await db.prepare(INSERT_OWNER).bind(hubId, owner).run();
  const current = await ownerOf(db, hubId);
  if (current === null) throw new Error('owners: no row after the insert');
  return current;
}
