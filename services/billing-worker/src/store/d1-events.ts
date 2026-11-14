// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type D1Database } from './d1';

/** True when the provider's delivery `id` was already handled to the end. */
export async function eventSeen(db: D1Database, id: string): Promise<boolean> {
  return (await db.prepare('SELECT id FROM provider_events WHERE id = ?').bind(id).first()) !== null;
}

/** Recorded only after a delivery was handled, so one that failed half-way is handled again when it is resent. */
export async function recordEvent(db: D1Database, id: string, at: number): Promise<void> {
  await db
    .prepare('INSERT INTO provider_events (id, received_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING')
    .bind(id, at)
    .run();
}

export async function deleteOldEvents(db: D1Database, before: number): Promise<void> {
  await db.prepare('DELETE FROM provider_events WHERE received_at < ?').bind(before).run();
}

export async function deleteOldDayCounts(db: D1Database, beforeDay: string): Promise<void> {
  await db.prepare('DELETE FROM day_counts WHERE day < ?').bind(beforeDay).run();
}
