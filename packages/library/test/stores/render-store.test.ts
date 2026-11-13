// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M11: render records. Create, get and patch round-trip core's
 * RenderRecord; requestKey de-duplication skips failed, cancelled and
 * deleted renders; the file path and QA report stay out of the columns a
 * snapshot is made from (they are separate fields the store never mixes in).
 */
import {
  FrameRates,
  newId,
  renderSnapshotSchema,
  unwrap,
  type ProjectId,
  type QaReport,
  type RenderRecord,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRenderStore } from '../../src/index';
import { openTestDb } from '../helpers';
import { seed } from './documents';

type NewRecord = Omit<RenderRecord, 'progress'> & { readonly requestKey: string };

function record(projectId: ProjectId, overrides: Partial<NewRecord> = {}): NewRecord {
  const timelineId = newId<'Timeline'>();
  return {
    id: newId<'Render'>(),
    projectId,
    timelineId,
    timelineRevision: 4,
    presetId: 'reels',
    status: 'queued',
    jobId: null,
    name: 'Goa – Reels',
    width: 1080,
    height: 1920,
    rate: FrameRates.fps30,
    durationFrames: 900,
    bytes: null,
    music: 'platformSound',
    captions: { burnIn: true, sidecars: ['srt'] },
    qa: null,
    supersedes: null,
    notify: false,
    error: null,
    credentials: { added: false, state: null },
    batchId: null,
    createdAt: 1,
    finishedAt: null,
    deletedAt: null,
    request: {
      projectId,
      timelineId,
      timelineRevision: 4,
      presetId: 'reels',
      captions: { burnIn: true, sidecars: ['srt'] },
      notify: false,
      contentCredentials: { add: false },
      includeBumpers: true,
    },
    filePath: null,
    compositionHash: null,
    qaReport: null,
    requestKey: 'key-1',
    ...overrides,
  };
}

const report = (renderId: RenderRecord['id']): QaReport => ({
  version: 1,
  renderId,
  round: 1,
  verdict: 'passed',
  presetId: 'reels',
  checks: [],
  overrides: [],
  createdAt: 3,
});

describe('render store', () => {
  it('creates, reads and patches a record; progress is never stored', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project } = seed(db);
    const input = record(project.id);
    const made = unwrap(await store.create(input));
    const { requestKey: _key, ...expected } = input;
    expect(made).toEqual({ ...expected, progress: null });
    expect(unwrap(await store.get(input.id))).toEqual(made);
    const ready = unwrap(
      await store.update(input.id, {
        status: 'ready',
        bytes: 12_000_000,
        filePath: '/Users/me/Movies/Taalcut/Goa – Reels.mp4',
        compositionHash: 'c'.repeat(64),
        qaReport: report(input.id),
        qa: { verdict: 'passed', round: 1, passed: 20, warned: 0, failed: 0, fixed: 0, failing: [] },
        finishedAt: 5,
      }),
    );
    expect([ready.status, ready.bytes, ready.finishedAt, ready.qaReport?.verdict]).toEqual([
      'ready',
      12_000_000,
      5,
      'passed',
    ]);
    // A window's snapshot is the snapshot schema's fields only: no path, no full report.
    const snapshot = renderSnapshotSchema.parse(ready);
    expect(Object.keys(snapshot)).not.toContain('filePath');
    expect(Object.keys(snapshot)).not.toContain('qaReport');
  });

  it('refuses invalid records and patches, and unknown ids', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project } = seed(db);
    const bad = await store.create(record(project.id, { width: 0 }));
    expect(!bad.ok && bad.error.code).toBe('core.validation');
    const input = record(project.id);
    unwrap(await store.create(input));
    const twice = await store.create(input);
    expect(!twice.ok && twice.error.code).toBe('core.conflict');
    const badPatch = await store.update(input.id, { status: 'exploded' as RenderRecord['status'] });
    expect(!badPatch.ok && badPatch.error.code).toBe('core.validation');
    expect(unwrap(await store.get(input.id)).status).toBe('queued');
    const missing = await store.update(newId<'Render'>(), { status: 'ready' });
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('de-duplicates by request key, skipping failed, cancelled and deleted renders', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project } = seed(db);
    const other = seed(db, 'Other').project;
    const failed = unwrap(await store.create(record(project.id, { status: 'failed', createdAt: 1 })));
    const cancelled = unwrap(await store.create(record(project.id, { status: 'cancelled', createdAt: 2 })));
    const deleted = unwrap(
      await store.create(record(project.id, { status: 'ready', createdAt: 3, deletedAt: 4 })),
    );
    const live = unwrap(await store.create(record(project.id, { status: 'rendering', createdAt: 5 })));
    unwrap(await store.create(record(other.id, { requestKey: 'key-2', createdAt: 6 })));
    const byKey = unwrap(await store.list({ requestKey: 'key-1' })).map((r) => r.id);
    expect(byKey).toEqual([live.id]);
    const ids = (records: readonly RenderRecord[]) => records.map((r) => r.id);
    expect(ids(unwrap(await store.list({ projectId: project.id })))).toEqual([
      live.id,
      cancelled.id,
      failed.id,
    ]);
    expect(ids(unwrap(await store.list({ projectId: project.id, includeDeleted: true })))).toEqual([
      live.id,
      deleted.id,
      cancelled.id,
      failed.id,
    ]);
    expect(unwrap(await store.list({ limit: 1 }))).toHaveLength(1);
  });

  it('lists a batch by its request and stores content credentials (P3)', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project } = seed(db);
    const batchId = newId<'RenderBatch'>();
    const plain = record(project.id);
    const inBatch = record(project.id, {
      requestKey: 'key-2',
      batchId,
      request: { ...plain.request, batchId },
    });
    unwrap(await store.create(plain));
    const made = unwrap(await store.create(inBatch));
    expect([made.batchId, made.credentials]).toEqual([batchId, { added: false, state: null }]);
    expect(unwrap(await store.list({ batchId })).map((r) => r.id)).toEqual([inBatch.id]);
    expect(unwrap(await store.get(plain.id)).batchId).toBeNull();
    const signed = unwrap(await store.update(inBatch.id, { credentials: { added: true, state: 'valid' } }));
    expect(signed.credentials).toEqual({ added: true, state: 'valid' });
    expect(unwrap(await store.get(inBatch.id)).credentials).toEqual({ added: true, state: 'valid' });
    expect(
      unwrap(await store.update(inBatch.id, { credentials: { added: false, state: null } })).status,
    ).toBe('queued');
  });

  it('stores the batch of a record that names it only on its request, and lists it by the index', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project } = seed(db);
    const batchId = newId<'RenderBatch'>();
    const plain = record(project.id);
    const only = record(project.id, { requestKey: 'key-3', request: { ...plain.request, batchId } });
    unwrap(await store.create(only));
    expect(db.driver.prepare('SELECT batch_id FROM renders WHERE id = ?').get(only.id)).toEqual({
      batch_id: batchId,
    });
    expect(unwrap(await store.list({ batchId })).map((r) => r.id)).toEqual([only.id]);
    const plan = db.driver
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM renders WHERE batch_id = ? AND deleted_at IS NULL')
      .all(batchId)
      .map((row) => String(row.detail))
      .join('; ');
    expect(plan).toMatch(/USING INDEX renders_batch_idx/);
  });

  it('reads a Phase 2 request with the P3 defaults and refuses a corrupt one (contract review 11)', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project } = seed(db);
    const input = record(project.id);
    unwrap(await store.create(input));
    // What a Phase 2 build wrote: no includeBumpers, no contentCredentials.
    db.driver
      .prepare(
        `UPDATE renders SET request = json_remove(request, '$.includeBumpers', '$.contentCredentials')`,
      )
      .run();
    const old = unwrap(await store.get(input.id));
    expect([old.request.includeBumpers, old.request.contentCredentials]).toEqual([true, { add: false }]);
    unwrap(await store.update(input.id, { status: 'rendering' }));
    const stored = db.driver
      .prepare(`SELECT json_extract(request, '$.includeBumpers') AS bumpers FROM renders WHERE id = ?`)
      .get(input.id);
    expect(stored?.bumpers).toBe(1);

    db.driver.prepare(`UPDATE renders SET request = json_set(request, '$.presetId', 7)`).run();
    const corrupt = await store.get(input.id);
    expect(!corrupt.ok && corrupt.error.code).toBe('core.validation');
    const listed = await store.list({ projectId: project.id });
    expect(!listed.ok && listed.error.code).toBe('core.validation');
  });

  it('goes with its project', async () => {
    const db = openTestDb({ file: false });
    const store = createRenderStore(db);
    const { project, repos } = seed(db);
    const input = record(project.id);
    unwrap(await store.create(input));
    unwrap(repos.projects.remove(project.id));
    expect((await store.get(input.id)).ok).toBe(false);
  });
});
