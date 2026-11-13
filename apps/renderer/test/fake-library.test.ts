// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  assetDetailSchema,
  assetSummarySchema,
  callRpc,
  createEventBus,
  indexingStatusSchema,
  searchResultSchema,
  sourceViewSchema,
  systemClock,
  transferStreamItemSchema,
  type Id,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { createFakeTransfer } from '../src/backend/fake/fake-transfer';
import { fakeLibrary } from '../src/backend/fake/library/assets';
import { fakeUlid, ulidNumber } from '../src/backend/fake/library/seed';
import { CLIP, TEMPLATE } from '../e2e/routes';

/**
 * The fake library is what the grid, search, the clip page and the e2e
 * performance check run on, so its payloads must be what the real library
 * sends: every view parses with core's schemas, and browse, search and
 * paging follow the contract.
 */
describe('fake library', () => {
  const { assets, sources } = fakeLibrary(5000);

  it('makes 5,000 clips that parse as core views, the same every time', () => {
    expect(assets).toHaveLength(5000);
    for (const asset of assets.slice(0, 400))
      expect(assetSummarySchema.safeParse(asset.summary).success).toBe(true);
    for (const source of sources) {
      const { volume: _volume, ...view } = source;
      expect(sourceViewSchema.safeParse(view).success).toBe(true);
    }
    expect(fakeLibrary(5000).assets[1234]!.summary).toEqual(assets[1234]!.summary);
    // A creator's mix: mostly vertical video, speech in all four v1 languages, some offline and failed.
    const vertical = assets.filter((a) => a.summary.orientation === 'portrait').length;
    expect(vertical / assets.length).toBeGreaterThan(0.6);
    const languages = new Set(assets.map((a) => a.summary.language).filter(Boolean));
    expect([...languages].sort()).toEqual(['en', 'es', 'hi', 'pt-BR']);
    expect(assets.some((a) => a.summary.availability === 'offline')).toBe(true);
    expect(assets.some((a) => a.summary.index.state === 'failed')).toBe(true);
  });

  it('round-trips ids', () => {
    const id = fakeUlid<'Asset'>(1, 4321);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulidNumber(id, 1)).toBe(4321);
    expect(ulidNumber(id, 2)).toBeNull();
  });

  it('serves browse, filters, paging, search and a clip in full over the contract', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const first = await client.library.browse({ limit: 60 });
    expect(first.items).toHaveLength(60);
    expect(first.total).toBeLessThan(5000); // missing originals are hidden by default
    expect(first.nextCursor).toBe('60');
    const second = await client.library.browse({ limit: 60, cursor: first.nextCursor });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const dates = first.items.map((a) => a.capturedAt ?? a.addedAt);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    const vertical = await client.library.browse({ filters: { orientations: ['portrait'] }, limit: 200 });
    expect(vertical.items.every((a) => a.orientation === 'portrait')).toBe(true);
    const failed = await client.library.browse({ filters: { indexStates: ['failed'] }, limit: 200 });
    expect(failed.total).toBeGreaterThan(0);
    expect(failed.items.every((a) => a.index.state === 'failed')).toBe(true);

    const found = await client.library.search({ query: 'sunset beach' });
    expect(searchResultSchema.safeParse(found).success).toBe(true);
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.hits[0]!.snippet?.highlights.length).toBeGreaterThan(0);
    const nothing = await client.library.search({ query: 'submarine volcano' });
    expect(nothing.hits).toEqual([]);

    const withSpeech =
      first.items.find((a) => a.language) ??
      (await client.library.browse({ filters: { hasSpeech: true }, limit: 1 })).items[0]!;
    const detail = await client.library.asset({ assetId: withSpeech.id });
    expect(assetDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.transcript?.lines.length).toBeGreaterThan(0);
    const transcript = await client.library.transcript({ assetId: withSpeech.id });
    expect(transcript?.segments[0]!.words.length).toBeGreaterThan(0);

    const similar = await client.library.findSimilar({ shotId: detail.shots[0]!.id });
    expect(similar.hits.every((hit) => hit.asset.id !== withSpeech.id)).toBe(true);

    expect(indexingStatusSchema.safeParse(await client.indexing.status()).success).toBe(true);
    const paused = await client.indexing.pause();
    expect(paused.paused).toBe(true);
    expect(paused.sources[0]?.state).toBe('paused');
  });

  it('an empty library has no clips and no sources', async () => {
    const { client } = createFakeBackend({ phase2: { library: { count: 0, tickMs: 0 } } });
    expect((await client.library.browse({})).total).toBe(0);
    expect(await client.library.sources()).toEqual([]);
  });
});

describe('fake Wi-Fi import', () => {
  it('listens only while the stream is read, and a phone pairs and sends files', async () => {
    const transfer = createFakeTransfer(createEventBus({ clock: systemClock }), { speed: 20 });
    const controller = new AbortController();
    const items = [];
    for await (const item of transfer.open(controller.signal)) {
      expect(transferStreamItemSchema.safeParse(item).success).toBe(true);
      items.push(item);
      expect(transfer.state().listening).toBe(true);
      if (item.type === 'file' && item.file.state === 'imported') break;
    }
    expect(items[0]).toMatchObject({ type: 'session', pairing: { pin: expect.stringMatching(/^\d{6}$/) } });
    expect(items.some((item) => item.type === 'session' && item.session.devices.length === 1)).toBe(true);
    // Leaving the screen ends the stream, and the server stops listening.
    expect(transfer.state().listening).toBe(false);
    expect(transfer.state().session?.stopReason).toBe('closed');
  });

  it('says when there is no network', async () => {
    const transfer = createFakeTransfer(createEventBus({ clock: systemClock }), { scenario: 'no-network' });
    const items = [];
    for await (const item of transfer.open()) items.push(item);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'session',
      session: { state: 'stopped', stopReason: 'no-network' },
    });
  });
});

it('the backend reports templates and library sources through callRpc as Results', async () => {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
  const missing = await callRpc(
    client.library.asset({ assetId: fakeUlid<'Asset'>(1, 999_999) as Id<'Asset'> }),
  );
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error.code).toBe('core.not_found');
});

it('serves the clip and the template the end-to-end checks open', async () => {
  const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
  const clip = await callRpc(client.library.asset({ assetId: CLIP as Id<'Asset'> }));
  expect(clip.ok && clip.value.asset.index.state).toBe('done');
  expect(clip.ok && clip.value.shots.length).toBeGreaterThan(3);
  expect(clip.ok && clip.value.transcript?.language).toBe('es');
  const template = await callRpc(client.templates.get({ templateId: TEMPLATE as Id<'Template'> }));
  expect(template.ok && template.value.template.slots).toHaveLength(12);
});
