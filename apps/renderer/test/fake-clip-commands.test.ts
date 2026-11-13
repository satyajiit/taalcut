// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// What the clip page's actions and edge states run on in the fake: the short silent clip with no shots, reachable
// by id only and parsing as core's detail; remove and put back (each the other's undo); analyse again; and a
// folder's look-through finding its missing clips; and a clip whose first read times out, then answers. Each command
// says what changed with library.changed, as the real one.
import { assetDetailSchema, callRpc, type AssetId, type Id } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { KIND } from '../src/backend/fake/library/assets';
import { FLAKY_CLIP, TINY_SILENT_CLIP } from '../src/backend/fake/library/edge-clips';
import { fakeUlid } from '../src/backend/fake/library/seed';
import { CLIP } from '../e2e/routes';

function setup() {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const undo = () => callRpc(client.commands.undo({ projectId: null, source: 'ui' }));
  const asset = async (assetId: string) => {
    const detail = await callRpc(client.library.asset({ assetId: assetId as AssetId }));
    if (!detail.ok) throw new Error(detail.error.code);
    return detail.value;
  };
  return { client, dispatch, undo, asset };
}

describe('the fake clip page', () => {
  it('has a short clip with no shots and no sound, by id only, every later step skipped with its reason', async () => {
    const { client, asset } = setup();
    const id = fakeUlid<'Asset'>(KIND.asset, TINY_SILENT_CLIP);
    const detail = await asset(id);
    expect(assetDetailSchema.safeParse(detail).error?.issues ?? []).toEqual([]);
    expect(detail.shots).toEqual([]);
    expect(detail.transcript).toBeNull();
    expect(detail.facts?.hasAudio).toBe(false);
    const reasons = new Map(detail.stages.map((row) => [row.stage, row.reasonKey ?? row.state]));
    expect(reasons.get('media.thumbnail')).toBe('done');
    expect(reasons.get('vision.shots')).toBe('indexing.skip.noShots');
    expect(reasons.get('audio.transcript')).toBe('indexing.skip.noAudio');
    expect(reasons.get('vision.describe')).toBe('indexing.skip.notAnalysed');
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.library.browse({ limit: 200, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.length).toBeGreaterThan(4000);
    expect(seen).not.toContain(id);
  });

  it('times out reading the flaky clip once, then answers with the clip itself', async () => {
    const { client, asset } = setup();
    const id = fakeUlid<'Asset'>(KIND.asset, FLAKY_CLIP);
    const first = await callRpc(client.library.asset({ assetId: id }));
    expect(first.ok ? null : first.error.code).toBe('core.timeout');
    const detail = await asset(id);
    expect(detail.asset.id).toBe(id);
    expect(detail.shots.length).toBeGreaterThan(0);
  });

  it('removes a clip and puts it back, each the other’s undo, and the grid follows', async () => {
    const { client, dispatch, undo, asset } = setup();
    const before = (await client.library.browse({ limit: 1 })).total;
    const removed = await dispatch('library.trashAssets', { assetIds: [CLIP] });
    expect(removed.ok).toBe(true);
    expect((await asset(CLIP)).asset.trashed).toBe(true);
    expect((await client.library.browse({ limit: 1 })).total).toBe(before - 1);
    expect((await undo()).ok).toBe(true);
    expect((await asset(CLIP)).asset.trashed).toBe(false);
    expect((await client.library.browse({ limit: 1 })).total).toBe(before);
    const unknown = await dispatch('library.trashAssets', {
      assetIds: [fakeUlid<'Asset'>(KIND.asset, 999_999)],
    });
    expect(unknown.ok ? null : unknown.error.code).toBe('core.not_found');
  });

  it('counts the import’s failed files from real clips; removing one or retrying takes it off', async () => {
    const { client, dispatch, asset } = setup();
    const importStatus = async () => (await client.indexing.status()).sources[0];
    const importFailed = async () => (await importStatus())?.counts.failed;
    const phone = (await client.library.sources())[0]?.id;
    const failed = await client.library.browse({
      filters: { indexStates: ['failed'], ...(phone ? { sourceIds: [phone] } : {}) },
      limit: 200,
    });
    // UX1-IMPORT: what the failed filter lists for the source is what the import counts, by the step that stopped it.
    expect(await importFailed()).toBe(failed.total);
    const unreadable = failed.items.filter((item) => item.index.done === 1);
    expect(unreadable).toHaveLength(2);
    const stages = (await importStatus())?.stages ?? [];
    expect(stages.find((row) => row.stage === 'media.normalise')?.failed).toBe(2);
    expect(stages.reduce((sum, row) => sum + row.failed, 0)).toBe(failed.total);
    const reasons = await Promise.all(
      unreadable.map(async (item) => (await asset(item.id)).stages.find((row) => row.state === 'failed')),
    );
    // Browse lists newest first; the reasons, in either order, are the library's two for an unreadable file.
    expect(reasons.map((row) => [row?.stage, row?.error?.messageKey]).sort()).toEqual([
      ['media.normalise', 'errors.media.probe_failed'],
      ['media.normalise', 'errors.media.unsupported_media'],
    ]);
    expect((await dispatch('library.trashAssets', { assetIds: [unreadable[0]?.id] })).ok).toBe(true);
    expect(await importFailed()).toBe(failed.total - 1);
    expect((await client.indexing.retryFailed({})).requeued).toBe(failed.total - 1);
    expect(await importFailed()).toBe(0);
  });

  it('analyses a clip again from its first step after identifying it', async () => {
    const { dispatch, asset } = setup();
    expect((await asset(CLIP)).asset.index.state).toBe('done');
    expect((await dispatch('library.reindexAssets', { assetIds: [CLIP] })).ok).toBe(true);
    const detail = await asset(CLIP);
    expect(detail.asset.index).toMatchObject({ state: 'indexing', done: 1, searchableAt: null });
    expect(detail.stages.find((row) => row.stage === 'media.normalise')?.state).toBe('running');
  });

  it('looks through a folder again and finds the clips it had lost there', async () => {
    const { client, dispatch, asset } = setup();
    const lost = await client.library.browse({ filters: { availability: ['missing'] }, limit: 200 });
    const details = await Promise.all(lost.items.map((item) => asset(item.id)));
    const referenced = details.find((detail) => detail.locations[0]?.storage === 'referenced');
    const location = referenced?.locations[0];
    if (!referenced || !location) throw new Error('the fake library has a missing clip in a folder');
    const result = await dispatch('library.rescanSource', { sourceId: location.sourceId as Id<'Source'> });
    expect(result.ok).toBe(true);
    await vi.waitFor(
      async () => expect((await asset(referenced.asset.id)).locations[0]?.state).toBe('present'),
      {
        timeout: 3000,
      },
    );
  });
});
