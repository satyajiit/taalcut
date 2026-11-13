// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Cross-process import ownership, disk reservations and eject barriers (migration 44). */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const importCaptureLocks = sqliteTable('import_capture_locks', {
  captureKey: text('capture_key').primaryKey(),
  pid: integer('pid').notNull(),
});

export const importSpaceReservations = sqliteTable(
  'import_space_reservations',
  {
    owner: text('owner').primaryKey(),
    volume: text('volume').notNull(),
    remaining: integer('remaining').notNull(),
    pid: integer('pid').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('import_space_volume').on(t.volume)],
);

export const importVolumeBarriers = sqliteTable('import_volume_barriers', {
  volume: text('volume').primaryKey(),
  pid: integer('pid').notNull(),
});

export const importVolumeReaders = sqliteTable(
  'import_volume_readers',
  {
    owner: text('owner').notNull(),
    volume: text('volume').notNull(),
    pid: integer('pid').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.volume] })],
);
