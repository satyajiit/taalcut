// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-D5 (database half): every command is committed before it is
 * acknowledged. A child process appends commands in a burst and prints each
 * one after append() returns; we kill -9 it mid-burst, reopen the database and
 * check that every acknowledged command is there, in order, with no gaps.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createAuditLogRepository, openDatabase } from '../src/index';
import { tempDir } from './helpers';

const CHILD = fileURLToPath(new URL('./fixtures/append-commands.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

interface Ack {
  readonly id: string;
  readonly seq: number;
}

/** Runs the child until it has acknowledged `killAfter` commands, then SIGKILLs it. */
async function burstAndKill(
  dbPath: string,
  killAfter: number,
): Promise<{ acks: Ack[]; signal: string | null }> {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, dbPath], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const acks: Ack[] = [];
  let pending = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) {
      const [word, id, seq] = line.split(' ');
      if (word !== 'ack') continue;
      acks.push({ id: id!, seq: Number(seq) });
      if (acks.length === killAfter) child.kill('SIGKILL');
    }
  });
  // 'close' fires after the process exits and its stdout is drained, so late acks are counted too.
  const [code, signal] = await new Promise<[number | null, string | null]>((resolve) =>
    child.on('close', (c, s) => resolve([c, s])),
  );
  if (signal !== 'SIGKILL') throw new Error(`child exited with ${code}: ${stderr}`);
  return { acks, signal };
}

describe('durability', () => {
  it('loses no acknowledged command when the writer is killed mid-burst', { timeout: 60_000 }, async () => {
    const dbPath = join(tempDir(), 'library.db');
    const acknowledged: Ack[] = [];
    // Three bursts against the same file, killed at different points.
    for (const killAfter of [150, 400, 275]) {
      const { acks, signal } = await burstAndKill(dbPath, killAfter);
      expect(signal).toBe('SIGKILL');
      expect(acks.length).toBeGreaterThanOrEqual(killAfter);
      acknowledged.push(...acks);
      // The kill left a hot WAL behind: recovery is SQLite replaying it, not our backup restore.
      expect(existsSync(`${dbPath}-wal`)).toBe(true);
    }

    const db = unwrap(openDatabase({ path: dbPath, integrityCheck: 'full' }));
    expect(db.opened.recovery.restoredFromBackup).toBeNull();
    const stored = unwrap(createAuditLogRepository(db).listByProject(null, { limit: 10_000 }));
    const byId = new Map(stored.map((e) => [e.id, e]));
    const missing = acknowledged.filter((ack) => byId.get(ack.id as never)?.sequence !== ack.seq);
    expect(missing).toEqual([]);
    // Nothing half-written: sequence numbers are 1..n with no gaps, and at most
    // one command per burst committed without being acknowledged.
    expect(stored.map((e) => e.sequence)).toEqual(stored.map((_, i) => i + 1));
    expect(stored.length - acknowledged.length).toBeLessThanOrEqual(3);
    process.stdout.write(
      `[durability] ${acknowledged.length} acknowledged, ${stored.length} stored after 3 × kill -9\n`,
    );
    db.close();
  });
});
