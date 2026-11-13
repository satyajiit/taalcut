// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The telemetry outbox as a JSON file in userData (mode 0600), for a container that has no library database. Each
 * write goes to a temp file that is fsynced, renamed over the queue and its folder fsynced (review L3), so a power
 * loss leaves the old queue or the new one, never a torn file. A file that still doesn't parse is moved aside to
 * `<file>.unreadable` before the queue starts again, so the next write can't silently replace it; clearing the
 * queue (telemetry turned off) deletes that copy too.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { telemetryEnvelopeSchema } from '@taalcut/core';
import { keepValid, type TelemetryOutbox, type TelemetryOutboxRow } from './outbox';

interface Persisted {
  nextId: number;
  rows: TelemetryOutboxRow[];
}

const empty = (): Persisted => ({ nextId: 1, rows: [] });

export function telemetryOutboxFile(userData: string): string {
  return join(userData, 'telemetry-outbox.json');
}

/** Where an outbox file that doesn't parse is kept (one copy; a later one replaces it). */
export function unreadableOutboxFile(file: string): string {
  return `${file}.unreadable`;
}

const codeOf = (cause: unknown) =>
  typeof cause === 'object' && cause && 'code' in cause ? (cause as { code?: unknown }).code : undefined;

function fsyncPath(path: string, flags: 'r' | 'r+'): void {
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The text to a fsynced temp file, renamed over `file`, then the folder fsynced so the rename is on disk too. */
function writeDurably(file: string, text: string): void {
  const folder = dirname(file);
  mkdirSync(folder, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  try {
    fsyncPath(temp, 'r+');
    renameSync(temp, file);
  } catch (cause) {
    rmSync(temp, { force: true });
    throw cause;
  }
  fsyncPath(folder, 'r');
}

/** Moves a queue that doesn't parse aside, so starting over never overwrites it. */
function setAside(file: string): void {
  try {
    renameSync(file, unreadableOutboxFile(file));
    console.warn('[telemetry] outbox unreadable: kept aside, starting a new queue');
  } catch (cause) {
    // Telemetry only: the queue starts again either way, and the warning says why the copy wasn't kept.
    console.warn('[telemetry] outbox unreadable and not kept aside', codeOf(cause) ?? 'unknown');
  }
}

function parsePersisted(parsed: unknown): Persisted | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { nextId?: unknown; rows?: unknown };
  const incoming = Array.isArray(record.rows) ? record.rows : [];
  const parsedRows: { id: number; envelope: unknown }[] = [];
  let maxId = 0;
  for (const row of incoming) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) continue;
    parsedRows.push({ id, envelope: (row as { envelope?: unknown }).envelope });
    if (id > maxId) maxId = id;
  }
  const rows = keepValid(parsedRows);
  const nextRaw = record.nextId;
  const nextId =
    typeof nextRaw === 'number' && Number.isSafeInteger(nextRaw) && nextRaw > maxId ? nextRaw : maxId + 1;
  return { nextId, rows };
}

function readPersisted(file: string): Persisted {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    if (codeOf(cause) !== 'ENOENT') console.warn('[telemetry] outbox not read');
    return empty();
  }
  let persisted: Persisted | null = null;
  try {
    persisted = parsePersisted(JSON.parse(text));
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
  }
  if (persisted) return persisted;
  setAside(file);
  return empty();
}

/** A new instance on the same path sees what the previous one ack'd. */
export function createFileTelemetryOutbox(file: string): TelemetryOutbox {
  let cache: Persisted | undefined;
  const load = (): Persisted => (cache ??= readPersisted(file));
  const write = (state: Persisted): void => {
    writeDurably(file, JSON.stringify(state));
    cache = state;
  };
  return {
    async append(envelope) {
      const parsed = telemetryEnvelopeSchema.safeParse(envelope);
      if (!parsed.success) return;
      const state = load();
      const rows = keepValid([...state.rows, { id: state.nextId, envelope: parsed.data }]);
      write({ nextId: state.nextId + 1, rows });
    },
    async take(limit) {
      const rows = load().rows;
      return rows
        .slice(0, Math.max(0, Math.floor(limit)))
        .map((row) => ({ id: row.id, envelope: row.envelope }));
    },
    async ack(ids) {
      const drop = new Set(ids);
      const state = load();
      const rows = state.rows.filter((row) => !drop.has(row.id));
      if (rows.length !== state.rows.length) write({ ...state, rows });
    },
    async clear() {
      const state = load();
      write({ nextId: state.nextId, rows: [] });
      rmSync(unreadableOutboxFile(file), { force: true });
    },
  };
}
