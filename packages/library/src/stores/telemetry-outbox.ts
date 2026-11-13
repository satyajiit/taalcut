// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The telemetry outbox (P2-X7) for the desktop's telemetry service in the
 * agent process: queued envelopes survive a quit. Each envelope is checked
 * against core's strict `telemetryEnvelopeSchema` on append and again on
 * take (a row that no longer parses, e.g. after an app update, is dropped,
 * not sent), so no media, text or file name can be queued. At most 5,000
 * rows; the oldest go first. Consent, batching and sending are the service's.
 */
import {
  err,
  ok,
  telemetryEnvelopeSchema,
  ValidationError,
  type Result,
  type TelemetryEnvelope,
} from '@taalcut/core';
import { inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite, inTransaction } from '../repositories/shared';
import { telemetryOutbox } from '../schema/projects';
import { parseJsonText } from '../db/json-text';

export const TELEMETRY_OUTBOX_CAP = 5_000;

export interface QueuedEnvelope {
  readonly id: number;
  readonly envelope: TelemetryEnvelope;
}

export interface TelemetryOutbox {
  /** Queues an envelope; returns its id. `core.validation` if it isn't a valid envelope. */
  append(envelope: TelemetryEnvelope): Result<number>;
  /** The oldest `limit` (1..500) valid envelopes; invalid rows met on the way are deleted. */
  take(limit: number): Result<QueuedEnvelope[]>;
  /** Removes sent envelopes. Returns how many were there. */
  ack(ids: readonly number[]): Result<number>;
  /** Telemetry was turned off: everything queued goes. */
  clear(): Result<number>;
  count(): number;
}

export function createTelemetryOutbox(
  db: LibraryDatabase,
  options: { readonly cap?: number } = {},
): TelemetryOutbox {
  const { orm } = db;
  const cap = options.cap ?? TELEMETRY_OUTBOX_CAP;
  return {
    append(envelope) {
      const parsed = telemetryEnvelopeSchema.safeParse(envelope);
      if (!parsed.success)
        return err(ValidationError({ field: 'envelope' }, { detail: parsed.error.message.slice(0, 1000) }));
      return inTransaction(db, 'telemetry_outbox', () => {
        const row = orm
          .insert(telemetryOutbox)
          .values({ envelope: parsed.data, createdAt: db.clock() })
          .returning({ id: telemetryOutbox.id })
          .get();
        db.driver
          .prepare(
            `DELETE FROM telemetry_outbox WHERE id <= (
               SELECT id FROM telemetry_outbox ORDER BY id DESC LIMIT 1 OFFSET ?)`,
          )
          .run(cap);
        return ok(row.id);
      });
    },
    take(limit) {
      const size = Math.max(1, Math.min(500, Math.floor(limit)));
      return inTransaction(db, 'telemetry_outbox', () => {
        const taken: QueuedEnvelope[] = [];
        const invalid: number[] = [];
        let after = -1;
        // Invalid rows are skipped and deleted, so keep reading until `size` valid ones or the end.
        while (taken.length < size) {
          const rows = db.driver
            .prepare('SELECT id, envelope FROM telemetry_outbox WHERE id > ? ORDER BY id LIMIT ?')
            .all(after, size - taken.length);
          if (rows.length === 0) break;
          for (const row of rows) {
            const id = Number(row.id);
            after = id;
            const parsed = parse(String(row.envelope));
            if (parsed) taken.push({ id, envelope: parsed });
            else invalid.push(id);
          }
        }
        if (invalid.length > 0) orm.delete(telemetryOutbox).where(inArray(telemetryOutbox.id, invalid)).run();
        return ok(taken);
      });
    },
    ack: (ids) =>
      ids.length === 0
        ? ok(0)
        : attemptWrite(
            db,
            'telemetry_outbox',
            () =>
              orm
                .delete(telemetryOutbox)
                .where(inArray(telemetryOutbox.id, [...ids]))
                .run().changes,
          ),
    clear: () => attemptWrite(db, 'telemetry_outbox', () => orm.delete(telemetryOutbox).run().changes),
    count: () => Number(db.driver.prepare('SELECT count(*) AS n FROM telemetry_outbox').get()?.n ?? 0),
  };
}

function parse(text: string): TelemetryEnvelope | undefined {
  return parseJsonText(telemetryEnvelopeSchema, text) ?? undefined;
}
