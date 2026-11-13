// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The queue the library owns (`createTelemetryOutbox`). This package keeps
 * the async port the telemetry service awaits, an adapter over the library's
 * synchronous Result and an in-memory fake for tests; the userData JSON file
 * for a container that has no library database is file-outbox.ts.
 */
import { telemetryEnvelopeSchema, type TelemetryEnvelope } from '@taalcut/core';
import type { TelemetryOutbox as LibraryTelemetryOutbox } from '@taalcut/library';

export const TELEMETRY_OUTBOX_CAP = 5_000;

export interface TelemetryOutboxRow {
  readonly id: number;
  readonly envelope: TelemetryEnvelope;
}

export interface TelemetryOutbox {
  append(envelope: TelemetryEnvelope): Promise<void>;
  /** Oldest first. Does not remove them; `ack` does, after a 200. */
  take(limit: number): Promise<TelemetryOutboxRow[]>;
  ack(ids: readonly number[]): Promise<void>;
  clear(): Promise<void>;
  /** Present when the store can count without reading every row. */
  count?(): Promise<number>;
}

/**
 * The library outbox is synchronous and returns Result. Invalid envelopes are
 * dropped, matching the file adapter. A store error is logged and swallowed
 * so `record` still does not throw.
 */
export function adaptLibraryTelemetryOutbox(outbox: LibraryTelemetryOutbox): TelemetryOutbox {
  return {
    async append(envelope) {
      const result = outbox.append(envelope);
      if (!result.ok && result.error.code !== 'core.validation')
        console.warn('[telemetry] outbox append failed');
    },
    async take(limit) {
      const result = outbox.take(limit);
      if (!result.ok) {
        console.warn('[telemetry] outbox take failed');
        return [];
      }
      return result.value;
    },
    async ack(ids) {
      const result = outbox.ack(ids);
      if (!result.ok) console.warn('[telemetry] outbox ack failed');
    },
    async clear() {
      const result = outbox.clear();
      if (!result.ok) console.warn('[telemetry] outbox clear failed');
    },
    async count() {
      try {
        return outbox.count();
      } catch {
        console.warn('[telemetry] outbox count failed');
        return 0;
      }
    },
  };
}

/** The rows whose envelope still parses, the newest `TELEMETRY_OUTBOX_CAP` of them. */
export function keepValid(rows: readonly { id: number; envelope: unknown }[]): TelemetryOutboxRow[] {
  const kept: TelemetryOutboxRow[] = [];
  for (const row of rows) {
    const parsed = telemetryEnvelopeSchema.safeParse(row.envelope);
    if (!parsed.success) continue;
    kept.push({ id: row.id, envelope: parsed.data });
  }
  return kept.length > TELEMETRY_OUTBOX_CAP ? kept.slice(kept.length - TELEMETRY_OUTBOX_CAP) : kept;
}

/** The in-memory fake: same shape as the library outbox, including the cap. */
export function createMemoryTelemetryOutbox(): TelemetryOutbox {
  let nextId = 1;
  let rows: TelemetryOutboxRow[] = [];
  return {
    async append(envelope) {
      const parsed = telemetryEnvelopeSchema.safeParse(envelope);
      if (!parsed.success) return;
      rows.push({ id: nextId, envelope: parsed.data });
      nextId += 1;
      if (rows.length > TELEMETRY_OUTBOX_CAP) rows.splice(0, rows.length - TELEMETRY_OUTBOX_CAP);
    },
    async take(limit) {
      return rows
        .slice(0, Math.max(0, Math.floor(limit)))
        .map((row) => ({ id: row.id, envelope: row.envelope }));
    },
    async ack(ids) {
      const drop = new Set(ids);
      rows = rows.filter((row) => !drop.has(row.id));
    },
    async clear() {
      rows = [];
    },
  };
}
