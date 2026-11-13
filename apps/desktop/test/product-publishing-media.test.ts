// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createContainer,
  CreationStoreToken,
  newId,
  ok,
  RenderStoreToken,
  TimelineStoreToken,
  type CreationStore,
  type ProductStore,
  type RenderRecord,
  type RenderStore,
  type TimelineStore,
} from '@taalcut/core';
import type { ProductPublishDraft } from '@taalcut/tools';
import {
  productDeliveryReady,
  productPublishMedia,
  productRenderHash,
} from '../src/utility/products/publishing-media';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'product-publishing-'));
  directories.push(directory);
  const filePath = join(directory, 'delivery.mp4');
  await writeFile(filePath, 'approved video');
  const projectId = newId<'Project'>();
  const render = {
    id: newId<'Render'>(),
    projectId,
    timelineId: newId<'Timeline'>(),
    timelineRevision: 4,
    presetId: 'shorts',
    filePath,
    status: 'ready',
    deletedAt: null,
    qa: { verdict: 'passed' },
    bytes: 14,
    rate: { num: 60, den: 1 },
    durationFrames: 2700,
    width: 1080,
    height: 1920,
    request: { codec: 'h264' },
  } as RenderRecord;
  const draft = {
    productId: newId<'Product'>(),
    campaignId: newId<'ProductCampaign'>(),
    platform: 'x',
  } as ProductPublishDraft;
  const timeline = { summary: { projectId, revision: 4 } };
  const creation = { status: 'ready' };
  const container = createContainer()
    .value(RenderStoreToken, { get: async () => ok(render) } as unknown as RenderStore)
    .value(TimelineStoreToken, { get: async () => ok(timeline) } as unknown as TimelineStore)
    .value(CreationStoreToken, { get: async () => ok(creation) } as unknown as CreationStore);
  const products = {
    getCampaign: async () => ok({ productId: draft.productId, projectId }),
  } as unknown as ProductStore;
  return { render, draft, timeline, creation, media: productPublishMedia(container, products) };
}

it('binds approval to the current timeline and exact exported file bytes', async () => {
  const { render, draft, timeline, creation, media } = await fixture();
  const hash = createHash('sha256').update('approved video').digest('hex');
  expect(await productRenderHash(render)).toEqual(ok(hash));
  expect(await media.verifyRender(render.id, hash, draft)).toEqual(ok(true));
  timeline.summary.revision++;
  expect((await media.verifyRender(render.id, hash, draft)).ok).toBe(false);
  timeline.summary.revision--;
  creation.status = 'producing';
  expect((await media.verifyRender(render.id, hash, draft)).ok).toBe(false);
  creation.status = 'ready';
  await writeFile(render.filePath!, 'modified video');
  expect(await media.verifyRender(render.id, hash, draft)).toEqual(ok(false));
});

it('rejects cross-product media, failed QA, and unsupported 4K delivery without losing the master', async () => {
  const { render, draft, media } = await fixture();
  expect((await media.verifyRender(render.id, 'bad', { ...draft, productId: newId<'Product'>() })).ok).toBe(
    false,
  );
  expect(productDeliveryReady({ ...render, width: 2160, height: 3840 }, 'x')).toBe(false);
  expect(productDeliveryReady({ ...render, width: 2160, height: 3840 }, 'youtube')).toBe(true);
  expect(productDeliveryReady({ ...render, qa: null }, 'youtube')).toBe(false);
  expect(productDeliveryReady({ ...render, durationFrames: 141 * 60 }, 'x')).toBe(false);
});

it('enforces Instagram audio and duration profiles and YouTube Shorts classification', async () => {
  const { render } = await fixture();
  expect(productDeliveryReady(render, 'instagram')).toBe(false);
  expect(productDeliveryReady({ ...render, presetId: 'reels' }, 'instagram')).toBe(true);
  expect(productDeliveryReady({ ...render, presetId: 'square', height: 1080 }, 'instagram')).toBe(true);
  expect(productDeliveryReady({ ...render, presetId: 'portrait', height: 1350 }, 'instagram')).toBe(true);
  expect(productDeliveryReady({ ...render, presetId: 'reels', durationFrames: 2 * 60 }, 'instagram')).toBe(
    false,
  );
  expect(productDeliveryReady({ ...render, presetId: 'reels', durationFrames: 180 * 60 }, 'instagram')).toBe(
    false,
  );
  expect(
    productDeliveryReady({ ...render, presetId: 'landscape', width: 1920, height: 1080 }, 'youtube'),
  ).toBe(false);
  expect(
    productDeliveryReady({ ...render, presetId: 'square2160', width: 2160, height: 2160 }, 'youtube'),
  ).toBe(true);
  expect(productDeliveryReady({ ...render, durationFrames: 180 * 60 }, 'youtube')).toBe(true);
  expect(productDeliveryReady({ ...render, durationFrames: 181 * 60 }, 'youtube')).toBe(false);
});
