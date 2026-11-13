// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Browse merges ratings, hides what the index omitted, and serves a stale cache offline. */
import { describe, expect, it } from 'vitest';
import {
  createManualClock,
  createMemorySettingsStore,
  HubOffline,
  newId,
  ok,
  type HubTemplateId,
  type TemplateId,
} from '@taalcut/core';
import { createHubIndexClient } from '../../src/hub/index-cache';
import { createHubService } from '../../src/hub/hub-service';
import {
  createMemoryHubIndexCache,
  createMemoryHubSubmissionStore,
} from '../../src/testing/memory-hub-stores';
import { createSettingsMyRatings } from '../../src/hub/my-ratings';
import { fakeTransport, hubIds, indexEntry, indexOf, sharedDocument } from './helpers';

const ENDPOINTS = { indexUrl: 'https://hub.example/v0/index.json', workerUrl: 'https://worker.example' };

function world(options?: { readonly localOnly?: boolean; readonly endpoints?: typeof ENDPOINTS | null }) {
  const clock = createManualClock(1_760_000_000_000);
  const cache = createMemoryHubIndexCache();
  const transport = fakeTransport();
  const index = createHubIndexClient({ cache, transport, clock });
  const myRatings = createSettingsMyRatings(createMemorySettingsStore());
  const forks = new Map<HubTemplateId, TemplateId>();
  let localOnly = options?.localOnly ?? false;
  const service = createHubService({
    endpoints: options?.endpoints === undefined ? ENDPOINTS : options.endpoints,
    localOnly: () => localOnly,
    transport,
    index,
    templates: { get: async () => ok({} as never) },
    submissions: createMemoryHubSubmissionStore(),
    clock,
    ids: hubIds(),
    newHubTemplateId: () => newId<'HubTemplate'>(),
    myRatings,
    forkedTemplate: async (hubId) => ok(forks.get(hubId) ?? null),
  });
  return {
    clock,
    cache,
    transport,
    index,
    myRatings,
    forks,
    service,
    setLocalOnly: (value: boolean) => (localOnly = value),
  };
}

describe('hub browse', () => {
  it('merges ratings, including means from fewer than three ratings, and leaves hidden ids out', async () => {
    const rig = world();
    const loved = indexEntry({ name: 'Loved', updatedAt: 5, trendFreshness: '2026-09-01' });
    const fresh = indexEntry({
      name: 'Fresh',
      handle: 'other.creator',
      language: 'hi',
      tags: ['food'],
      formatId: null,
      updatedAt: 50,
      createdAt: 40,
      trendFreshness: '2026-10-02',
      duration: { value: 300, rate: { num: 30, den: 1 } },
    });
    const quiet = indexEntry({
      name: 'Quiet',
      updatedAt: 30,
      trendFreshness: null,
      tags: ['travel', 'food'],
    });
    const hidden = newId<'HubTemplate'>();
    const index = indexOf([loved, fresh, quiet]);
    const etags: Array<string | null> = [];
    rig.transport.index = async (etag) => {
      etags.push(etag);
      return ok({ status: 200, body: index, etag: 'W/"1"' });
    };
    rig.transport.ratings = async () =>
      ok({
        generatedAt: 1,
        ratings: {
          [loved.id]: { count: 2, mean: 4.5 },
          [fresh.id]: { count: 9, mean: 3 },
          [hidden]: { count: 20, mean: 5 },
        },
      });
    const forkId = newId<'Template'>();
    rig.forks.set(loved.id, forkId);

    const page = await rig.service.browse({ sort: 'topRated', limit: 50 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.map((item) => item.id)).toEqual([loved.id, fresh.id, quiet.id]);
    expect(page.value.items.map((item) => item.rating)).toEqual([
      { count: 2, mean: 4.5 },
      { count: 9, mean: 3 },
      null,
    ]);
    expect(page.value.items.map((item) => item.forkedAs)).toEqual([forkId, null, null]);
    expect(page.value.items.some((item) => item.id === hidden)).toBe(false);
    expect(page.value.nextCursor).toBeNull();

    const hindi = await rig.service.browse({ language: 'hi', sort: 'newest', limit: 50 });
    expect(hindi.ok && hindi.value.items.map((item) => item.id)).toEqual([fresh.id]);
    const vlog = await rig.service.browse({ formatId: 'vlog', sort: 'newest', limit: 50 });
    expect(vlog.ok && vlog.value.items.map((item) => item.id).sort()).toEqual([loved.id, quiet.id].sort());
    const short = await rig.service.browse({ maxSeconds: 4, sort: 'newest', limit: 50 });
    expect(short.ok && short.value.items.every((item) => item.id !== fresh.id)).toBe(true);
    const both = await rig.service.browse({ tags: ['travel', 'food'], sort: 'newest', limit: 50 });
    expect(both.ok && both.value.items.map((item) => item.id)).toEqual([quiet.id]);
    const words = await rig.service.browse({ query: 'OTHER', sort: 'newest', limit: 50 });
    expect(words.ok && words.value.items.map((item) => item.id)).toEqual([fresh.id]);
    const newest = await rig.service.browse({ sort: 'newest', limit: 50 });
    expect(newest.ok && newest.value.items.map((item) => item.name)).toEqual(['Fresh', 'Quiet', 'Loved']);
    const freshest = await rig.service.browse({ sort: 'freshest', limit: 50 });
    expect(freshest.ok && freshest.value.items.map((item) => item.name)).toEqual(['Fresh', 'Loved', 'Quiet']);
  });

  it('pages 50 at a time', async () => {
    const rig = world();
    const templates = Array.from({ length: 51 }, (_, index) =>
      indexEntry({ name: `T${index}`, updatedAt: index }),
    );
    rig.transport.index = async () => ok({ status: 200, body: indexOf(templates), etag: null });
    const first = await rig.service.browse({ sort: 'newest', limit: 50 });
    expect(first.ok && first.value.items).toHaveLength(50);
    expect(first.ok && first.value.nextCursor).toBe('50');
    const second = await rig.service.browse({ sort: 'newest', limit: 50, cursor: '50' });
    expect(second.ok && second.value.items).toHaveLength(1);
    expect(second.ok && second.value.nextCursor).toBeNull();
  });

  it('refuses local only before any fetch', async () => {
    const rig = world({ localOnly: true });
    await rig.cache.writeIndex({ etag: 'W/"cached"', fetchedAt: 1, body: indexOf([indexEntry()]) });
    const page = await rig.service.browse({ sort: 'topRated', limit: 50 });
    expect(!page.ok && page.error.code).toBe('core.local_only');
    expect(rig.transport.calls).toEqual([]);
  });

  it('browses a stale cache when the index refresh is offline, and sends the etag', async () => {
    const rig = world();
    const cached = indexOf([indexEntry({ name: 'Cached reel' })]);
    await rig.cache.writeIndex({ etag: 'W/"old"', fetchedAt: 0, body: cached });
    rig.transport.index = async (etag) => {
      rig.transport.calls.push(`index:${etag}`);
      return errOffline();
    };
    const page = await rig.service.browse({ sort: 'topRated', limit: 50 });
    expect(page.ok && page.value.items.map((item) => item.name)).toEqual(['Cached reel']);
    expect(rig.transport.calls).toContain('index:W/"old"');
    const status = await rig.service.status();
    expect(status.ok && status.value.indexFetchedAt).toBe(0);
    expect(status.ok && status.value.templates).toBe(1);
    expect(status.ok && status.value.configured).toBe(true);
  });

  it('returns the seeded star on get and checks the file hash', async () => {
    const rig = world();
    const shared = sharedDocument();
    const entry = indexEntry({
      id: shared.doc.id,
      version: shared.doc.version,
      sha256: shared.sha256,
      name: shared.doc.name,
    });
    rig.transport.index = async () => ok({ status: 200, body: indexOf([entry]), etag: 'W/"t"' });
    rig.transport.template = async () =>
      ok({ body: JSON.parse(shared.text) as unknown, sha256: shared.sha256 });
    await rig.myRatings.set(entry.id, 4);
    const detail = await rig.service.get(entry.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.myRating).toBe(4);
    expect(detail.value.document.id).toBe(shared.doc.id);
    expect(detail.value.item.sha256).toBe(shared.sha256);
  });

  it('fails browse when the library cannot say which templates were forked', async () => {
    const w = world();
    w.transport.index = async () => ok({ status: 200, body: indexOf([indexEntry()]), etag: null });
    const failing = createHubService({
      endpoints: ENDPOINTS,
      localOnly: () => false,
      transport: w.transport,
      index: w.index,
      templates: { get: async () => ok({} as never) },
      submissions: createMemoryHubSubmissionStore(),
      clock: w.clock,
      ids: hubIds(),
      newHubTemplateId: () => newId<'HubTemplate'>(),
      myRatings: w.myRatings,
      forkedTemplate: async () => errOffline(),
    });
    const page = await failing.browse({ sort: 'newest', limit: 10 });
    expect(!page.ok && page.error.code).toBe('hub.offline');
  });
});

function errOffline() {
  return { ok: false as const, error: HubOffline() };
}
