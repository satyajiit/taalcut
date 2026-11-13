// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-D5: a crash between a command's change and its audit append can't leave
 * one without the other. A child process renames a project through core's
 * command bus and library's unit of work and is killed (SIGKILL) inside the
 * commit of one rename: once after the audit row is written but before the
 * change, once after both. Reopened, the database holds every acknowledged
 * command with its change, and neither half of the killed one.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrap, type ProjectId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, openDatabase } from '../src/index';
import { tempDir } from './helpers';

const CHILD = fileURLToPath(new URL('./fixtures/command-child.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

async function runUntilKilled(dbPath: string, killAt: number, phase: 'before' | 'after') {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, dbPath, String(killAt), phase], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const acks: number[] = [];
  let projectId: ProjectId | undefined;
  let pending = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) {
      const [word, value] = line.split(' ');
      if (word === 'project') projectId = value as ProjectId;
      if (word === 'ack') acks.push(Number(value));
    }
  });
  const [code, signal] = await new Promise<[number | null, string | null]>((resolve) =>
    child.on('close', (c, s) => resolve([c, s])),
  );
  if (signal !== 'SIGKILL' || !projectId) throw new Error(`child exited with ${code}: ${stderr}`);
  return { acks, projectId };
}

describe('command crash atomicity', () => {
  it.each(['before', 'after'] as const)(
    'keeps neither half of a command killed %s its change was written',
    { timeout: 60_000 },
    async (phase) => {
      const killAt = 25;
      const path = join(tempDir(), 'library.db');
      const { acks, projectId } = await runUntilKilled(path, killAt, phase);
      expect(acks).toEqual(Array.from({ length: killAt - 1 }, (_, i) => i + 1));

      const db = unwrap(openDatabase({ path }));
      const repos = createRepositories(db);
      const log = unwrap(repos.auditLog.listByProject(projectId));
      // Every acknowledged command, with its change; nothing of the killed one.
      expect(log.map((entry) => entry.sequence)).toEqual(acks);
      expect(log.map((entry) => (entry.payload as { name: string }).name)).toEqual(
        acks.map((i) => `name-${i}`),
      );
      expect(unwrap(repos.projects.get(projectId)).name).toBe(`name-${killAt - 1}`);
      const report = db.opened.recovery.lastCommands.find((p) => p.projectId === projectId);
      expect(report?.commands.at(-1)).toMatchObject({ sequence: killAt - 1, name: 'project.rename' });
      db.close();
    },
  );
});
