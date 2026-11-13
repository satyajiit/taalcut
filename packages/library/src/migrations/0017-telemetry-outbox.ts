// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The telemetry outbox (P2-X7): envelopes the desktop's telemetry service
 * queues, so they survive a quit. AUTOINCREMENT, so an id is never reused:
 * acknowledging a batch that was taken before the table emptied can't delete
 * a newer envelope that got the same id.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE telemetry_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  envelope TEXT NOT NULL CHECK (json_valid(envelope)),
  created_at INTEGER NOT NULL
) STRICT;
`;

const down = `
DROP TABLE telemetry_outbox;
`;

export const telemetryOutbox: Migration = { version: 17, name: 'telemetry_outbox', up, down };
