// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X3 "no loss on crash": a child process saves timeline versions through
 * core's command bus and the project commands and is killed (SIGKILL)
 * inside the commit of one save, once before its version row is written and
 * once after. Reopened, the database holds every acknowledged save with its
 * audit row, and nothing of the killed one.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrap, type ProjectId, type TimelineId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, createTimelineVersions, openDatabase } from '../../src/index';
import { tempDir } from '../helpers';

const CHILD = fileURLToPath(new URL('./save-child.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

async function runUntilKilled(dbPath: string, killAt: number, phase: 'before' | 'after') {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, dbPath, String(killAt), phase], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const acks: { n: number; id: string }[] = [];
  let ids: { projectId: ProjectId; timelineId: TimelineId } | undefined;
  let pending = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) {
      const [word, a, b] = line.split(' ');
      if (word === 'timeline') ids = { projectId: a as ProjectId, timelineId: b as TimelineId };
      if (word === 'ack') acks.push({ n: Number(a), id: b! });
    }
  });
  const [code, signal] = await new Promise<[number | null, string | null]>((resolve) =>
    child.on('close', (c, s) => resolve([c, s])),
  );
  if (signal !== 'SIGKILL' || !ids) throw new Error(`child exited with ${code}: ${stderr}`);
  return { acks, ...ids };
}

describe('saving a version survives a crash', () => {
  it.each(['before', 'after'] as const)(
    'keeps every acknowledged save and none of one killed %s its version was written',
    { timeout: 60_000 },
    async (phase) => {
      const killAt = 12;
      const path = join(tempDir(), 'library.db');
      const { acks, projectId, timelineId } = await runUntilKilled(path, killAt, phase);
      expect(acks.map((a) => a.n)).toEqual(Array.from({ length: killAt - 1 }, (_, i) => i + 1));

      const db = unwrap(openDatabase({ path }));
      const log = unwrap(createRepositories(db).auditLog.listByProject(projectId));
      expect(log.map((entry) => entry.id)).toEqual(acks.map((a) => a.id));
      const named = unwrap(createTimelineVersions(db).list(timelineId, { limit: 200 }))
        .items.filter((v) => v.kind === 'named')
        .map((v) => [v.id, v.label])
        .reverse();
      expect(named).toEqual(acks.map((a) => [a.id, `save-${a.n}`]));
      db.close();
    },
  );
});
