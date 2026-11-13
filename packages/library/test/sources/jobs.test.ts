// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's job kinds: a scan SIGKILLed mid-way resumes after its saved
 * cursor in a new process; the registrations the jobs root takes; the
 * `library.hash` stage definition; enqueueing as an outbox (a queued scan is
 * reused, a finished one doesn't block the next, a rolled-back transaction
 * leaves no job).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CancelledError,
  err,
  ok,
  unwrap,
  type AssetId,
  type AssetIndexView,
  type JobContext,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createJobRepository,
  createLibraryJobs,
  enqueueInTransaction,
  enqueueScan,
  hashAssetJob,
  libraryHashStage,
  scanSourceJob,
} from '../../src/index';
import { inTransaction } from '../../src/repositories/shared';
import { fakeVolumes, library, writeMedia } from './fixture';

const CHILD = fileURLToPath(new URL('./scan-child.ts', import.meta.url));

function runChild(args: string[]): Promise<NodeJS.Signals | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, ...args], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (_code, signal) => resolve(signal));
  });
}

const context: JobContext = {
  jobId: 'job' as never,
  projectId: null,
  attempt: 1,
  signal: new AbortController().signal,
  progress: () => {},
};

describe('library jobs', () => {
  it('resumes a scan killed mid-way after its last finished batch, reading nothing twice', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    for (let i = 0; i < 10; i++) writeMedia(root, `clip-${String(i).padStart(2, '0')}.mov`);
    expect(await runChild([lib.db.path, id, '8'])).toBe('SIGKILL');
    const killed = unwrap(lib.repos.sources.get(id));
    // Batches of 3: two finished (6 files) before the kill during the third.
    expect(killed.scanCursor).toMatch(/^\d+:clip-05\.mov$/);
    expect(lib.locations(id)).toHaveLength(6);

    const resumed = await lib.scan({ sourceId: id, mode: 'full' });
    expect(resumed).toMatchObject({ end: 'done', added: 4, missing: 0 });
    expect(lib.calls.partial.map((p) => p.split('/').pop())).toEqual([
      'clip-06.mov',
      'clip-07.mov',
      'clip-08.mov',
      'clip-09.mov',
    ]);
    expect(lib.locations(id).map((l) => l.state)).toEqual(Array(10).fill('present'));
    expect(lib.assetCount()).toBe(10);
  }, 60_000);

  it('registers the five library job kinds, on the io pool', () => {
    const lib = library();
    const jobs = createLibraryJobs({ db: lib.db, volumes: fakeVolumes() });
    expect(jobs.map((j) => [j.kind.kind, j.kind.resource, j.kind.priority])).toEqual([
      ['library.scanSource', 'io', 'normal'],
      ['library.hashAsset', 'io', 'normal'],
      ['library.findMissingFiles', 'io', 'low'],
      ['library.sweepStaging', 'io', 'low'],
      ['library.collect', 'io', 'low'],
    ]);
  });

  it('hashes through the job and the library.hash stage, as the pipeline would run it', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'a.mov', 3000);
    await lib.scan({ sourceId: id, mode: 'full' });
    const assetId = lib.locations(id)[0]!.assetId as AssetId;
    const view = { assetId, generation: 0, kind: 'video' } as AssetIndexView;
    const built = libraryHashStage.job(view);
    expect('kind' in built && built.kind.kind).toBe(hashAssetJob.kind);
    const handler = createLibraryJobs({ db: lib.db, volumes: fakeVolumes() }).find(
      (j) => j.kind === hashAssetJob,
    )!;
    const output = unwrap(await handler.handler('input' in built ? built.input : null, context));
    expect(output).toEqual({ contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(hashAssetJob.output.safeParse(output).success).toBe(true);
    expect(libraryHashStage.result(output, view)).toEqual(ok({}));
    const offline = await handler.handler(
      { assetId, generation: 0 },
      { ...context, signal: AbortSignal.abort() },
    );
    // Already hashed: the stored hash, no read.
    expect(offline).toEqual(ok(output));
  });

  it('reuses a queued scan, but not a finished one, and leaves no job when the transaction rolls back', () => {
    const lib = library();
    const { id } = lib.addFolder();
    const jobs = createJobRepository(lib.db);
    const first = unwrap(enqueueScan(lib.db, { sourceId: id, mode: 'full' }));
    const again = unwrap(enqueueScan(lib.db, { sourceId: id, mode: 'full' }));
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
    const paths = unwrap(enqueueScan(lib.db, { sourceId: id, mode: 'paths', paths: ['b.mov', 'a.mov'] }));
    expect(paths.created).toBe(true);
    unwrap(jobs.cancel(first.job.id));
    expect(unwrap(enqueueScan(lib.db, { sourceId: id, mode: 'full' })).created).toBe(true);

    const before = jobs.list().length;
    const failed = inTransaction(lib.db, 'test', () => {
      unwrap(enqueueScan(lib.db, { sourceId: id, mode: 'paths', paths: ['c.mov'] }));
      return err(CancelledError());
    });
    expect(failed.ok).toBe(false);
    expect(jobs.list()).toHaveLength(before);
    const invalid = enqueueInTransaction(lib.db, {
      kind: scanSourceJob,
      input: { sourceId: id, mode: 'sideways' as 'full' },
    });
    expect(!invalid.ok && invalid.error.code).toBe('core.validation');
  });
});
