// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P1-D5: the "what was recovered" report built when the database opens. */
import { join } from 'node:path';
import { unwrap, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, openDatabase, type RecoveryOptions } from '../src/index';
import { auditEntry } from './fixtures/records';
import { fakeClock, openTestDb, tempDir } from './helpers';

/** A database a process was using when it died: runs, jobs and commands in flight. */
function crashedDatabase() {
  const clock = fakeClock();
  const path = join(tempDir(), 'library.db');
  const db = unwrap(openDatabase({ path, clock: clock.now }));
  const repos = createRepositories(db);
  const trip = unwrap(repos.projects.create({ name: 'Trip' }));
  const wedding = unwrap(repos.projects.create({ name: 'Wedding' }));
  for (const [projectId, n] of [
    [trip.id, 4],
    [null, 1],
    [wedding.id, 2],
  ] as const) {
    for (let i = 0; i < n; i++) {
      clock.advance(10);
      unwrap(repos.auditLog.append(auditEntry({ projectId, createdAt: clock.now(), payload: { i } })));
    }
  }
  const started = (at: number) => [{ at, type: 'run.started', data: {} }];
  unwrap(repos.runLog.append('running' as RunId, started(1), { expectedSeq: 0 }));
  unwrap(repos.runLog.append('paused' as RunId, started(2), { expectedSeq: 0, status: 'paused' }));
  unwrap(repos.runLog.append('done' as RunId, started(3), { expectedSeq: 0, status: 'succeeded' }));
  const enqueue = (kind: string, maxAttempts = 3) =>
    unwrap(repos.jobs.enqueue({ kind, payload: {}, resourceClass: 'cpu', maxAttempts, projectId: trip.id }))
      .job;
  const resumable = enqueue('media.probe');
  const lastTry = enqueue('media.transcode', 1);
  const live = enqueue('vision.embed');
  unwrap(repos.jobs.claimNext({ owner: 'dead', leaseMs: 100, kinds: ['media.probe'] }));
  unwrap(repos.jobs.heartbeat(resumable.id, 'dead', { leaseMs: 100, progress: 0.4 }));
  unwrap(repos.jobs.claimNext({ owner: 'dead', leaseMs: 100, kinds: ['media.transcode'] }));
  unwrap(repos.jobs.claimNext({ owner: 'alive', leaseMs: 60_000, kinds: ['vision.embed'] }));
  db.close();
  clock.advance(1000);
  const reopen = (recovery?: RecoveryOptions) => unwrap(openDatabase({ path, clock: clock.now, recovery }));
  return { reopen, trip, wedding, resumable, lastTry, live };
}

describe('recovery report', () => {
  it('is empty for a fresh database', () => {
    expect(openTestDb().opened.recovery).toEqual({
      restoredFromBackup: null,
      unfinishedRuns: [],
      reclaimedJobs: [],
      lastCommands: [],
      needsAttention: false,
    });
  });

  it('reports unfinished runs, reclaimed jobs and the last commands per project', () => {
    const { reopen, trip, wedding, resumable, lastTry } = crashedDatabase();
    const db = reopen({ commandsPerProject: 2 });
    const report = db.opened.recovery;
    expect(report.needsAttention).toBe(true);
    expect(report.unfinishedRuns.map((r) => [r.runId, r.status])).toEqual([
      ['paused', 'paused'],
      ['running', 'running'],
    ]);
    expect(report.reclaimedJobs).toEqual([
      { id: resumable.id, kind: 'media.probe', projectId: trip.id, state: 'queued', progress: 0.4 },
      { id: lastTry.id, kind: 'media.transcode', projectId: trip.id, state: 'failed', progress: null },
    ]);
    expect(report.lastCommands.map((p) => [p.projectName, p.commands.map((c) => c.sequence)])).toEqual([
      ['Wedding', [1, 2]],
      [null, [1]],
      ['Trip', [3, 4]],
    ]);
    expect(report.lastCommands[0]).toMatchObject({ projectId: wedding.id });
    expect(report.lastCommands[0]!.commands[1]).toMatchObject({
      name: 'project.rename',
      undone: false,
      actor: 'user',
    });
    // The reclaimed job is due again, with its progress, for the engine to resume.
    expect(unwrap(createRepositories(db).jobs.get(resumable.id))).toMatchObject({
      state: 'queued',
      progress: 0.4,
    });
    db.close();
  });

  it('reclaims every running job at app start, or none', () => {
    const all = crashedDatabase();
    const db = all.reopen({ reclaimJobs: 'all', projects: 1 });
    expect(db.opened.recovery.reclaimedJobs.map((j) => j.id)).toContain(all.live.id);
    expect(db.opened.recovery.lastCommands).toHaveLength(1);
    db.close();

    const none = crashedDatabase().reopen({ reclaimJobs: 'none' });
    expect(none.opened.recovery.reclaimedJobs).toEqual([]);
    expect(none.opened.recovery.needsAttention).toBe(true); // the unfinished runs are still there
    none.close();
  });

  it('only lists the restore for a database below the latest schema', () => {
    const db = openTestDb({ targetVersion: 1 });
    expect(db.opened.recovery).toMatchObject({
      restoredFromBackup: null,
      lastCommands: [],
      needsAttention: false,
    });
  });
});
