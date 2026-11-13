// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CommandBusToken,
  RenderStoreToken,
  createContainer,
  newId,
  ok,
  unwrap,
  type CommandBus,
  type ProductCampaign,
  type ProductStore,
  type RenderRecord,
  type RenderStore,
  type Timeline,
} from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { ensureProductRenders, productExportPresets } from '../src/utility/products/exports';

function fixture() {
  let campaign: ProductCampaign = {
    id: newId<'ProductCampaign'>(),
    productId: newId<'Product'>(),
    ideaId: newId<'ProductIdea'>(),
    projectId: newId<'Project'>(),
    conversationId: null,
    revision: 1,
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
  };
  const timeline = {
    id: newId<'Timeline'>(),
    revision: 1,
    canvas: { width: 1080, height: 1920 },
  } as Timeline;
  const records = new Map<string, RenderRecord>();
  const dispatch = vi.fn(async (_name: string, input: Record<string, unknown>) => {
    const id = newId<'Render'>();
    records.set(id, {
      id,
      ...input,
      status: 'queued',
      filePath: null,
      qa: null,
      error: null,
    } as unknown as RenderRecord);
    return ok({ result: { renderId: id } });
  });
  const container = createContainer()
    .value(CommandBusToken, { dispatch } as unknown as CommandBus)
    .value(RenderStoreToken, { get: async (id) => ok(records.get(id)!) } as RenderStore);
  const products: Pick<ProductStore, 'getCampaign' | 'saveCampaign'> = {
    getCampaign: async () => ok(campaign),
    saveCampaign: async (next) => {
      campaign = next;
      return ok(undefined);
    },
  };
  return { container, products, records, timeline, dispatch, campaign: () => campaign };
}

it('pins queued renders and requires both current master and delivery QA before announcing readiness', async () => {
  const f = fixture();
  expect(unwrap(await ensureProductRenders(f.container, f.products, f.campaign(), [f.timeline]))).toBe(false);
  expect(f.campaign().renders).toHaveLength(2);
  expect(unwrap(await ensureProductRenders(f.container, f.products, f.campaign(), [f.timeline]))).toBe(false);
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  for (const [id, render] of f.records)
    f.records.set(id, {
      ...render,
      status: 'ready',
      filePath: '/video.mp4',
      qa: { verdict: 'passed' } as RenderRecord['qa'],
    });
  expect(unwrap(await ensureProductRenders(f.container, f.products, f.campaign(), [f.timeline]))).toBe(true);
  expect(
    (await ensureProductRenders(f.container, f.products, f.campaign(), [{ ...f.timeline, revision: 2 }])).ok,
  ).toBe(false);
});

it('surfaces render failure and QA attention without silently retrying or treating queued as ready', async () => {
  const f = fixture();
  unwrap(await ensureProductRenders(f.container, f.products, f.campaign(), [f.timeline]));
  const [id, record] = [...f.records][0]!;
  f.records.set(id, { ...record, status: 'failed' });
  expect((await ensureProductRenders(f.container, f.products, f.campaign(), [f.timeline])).ok).toBe(false);
  f.records.set(id, { ...record, status: 'needsAttention' });
  expect((await ensureProductRenders(f.container, f.products, f.campaign(), [f.timeline])).ok).toBe(false);
  expect(f.dispatch).toHaveBeenCalledTimes(2);
});

it('preserves every requested aspect ratio for master and delivery', () => {
  expect(productExportPresets({ width: 100, height: 100 })).toEqual(['square2160', 'square']);
  expect(productExportPresets({ width: 1080, height: 1350 })).toEqual(['portrait2160', 'portrait']);
  expect(productExportPresets({ width: 1920, height: 1080 })).toEqual(['landscape4k', 'landscape']);
  expect(productExportPresets({ width: 1080, height: 1920 })).toEqual(['master4k', 'reels']);
});
