// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, unwrap } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { productFixture } from './fixture';

it('keeps source provenance, enforces history beyond prompt limits, and reserves before authoring', async () => {
  const f = productFixture();
  const ideas = unwrap(await f.service.research(f.product.id));
  expect(ideas[0]?.evidence[0]).toMatchObject({ locator: 'https://example.com/docs', digest: 'hash' });
  const campaign = unwrap(await f.service.choose(f.product.id, ideas[0]!.id));
  expect(f.deps.creation.create).not.toHaveBeenCalled();
  expect(f.campaigns).toHaveLength(1);
  const resumed = unwrap(await f.service.resumeCampaign(campaign.id));
  expect(resumed.conversationId).not.toBeNull();
  unwrap(await f.service.resumeCampaign(campaign.id));
  expect(f.deps.creation.create).toHaveBeenCalledTimes(1);
  f.store.hasRecentFeature.mockResolvedValue(ok(true));
  const repeated = await f.service.research(f.product.id);
  expect(unwrap(repeated)).toEqual([]);
});

it('resumes an occurrence shortlist after a crash without another model call or video', async () => {
  const f = productFixture();
  f.product.preferences.ideaPolicy = 'auto-draft';
  const first = unwrap(await f.service.runScheduled(f.product.id, undefined, f.occurrence.id));
  expect(f.occurrence.ideaIds).toEqual(first.ideas.map((idea) => idea.id));
  const retry = unwrap(await f.service.runScheduled(f.product.id, undefined, f.occurrence.id));
  expect(retry.campaign?.id).toBe(first.campaign?.id);
  expect(f.deps.model.shortlist).toHaveBeenCalledTimes(1);
  expect(f.deps.creation.create).not.toHaveBeenCalled();
  unwrap(await f.service.resumeCampaign(retry.campaign!.id));
  expect(f.deps.creation.create).toHaveBeenCalledTimes(1);
});

it('refuses stale evidence, changed product preferences and a full daily draft budget', async () => {
  const f = productFixture();
  const ideas = unwrap(await f.service.research(f.product.id));
  const docs = unwrap(await f.store.knowledge());
  f.store.knowledgeByIds.mockResolvedValueOnce(ok([{ ...docs[0]!, digest: 'changed' }]));
  expect(await f.service.choose(f.product.id, ideas[0]!.id)).toMatchObject({
    ok: false,
    error: { code: 'agent.product_evidence_changed' },
  });
  f.campaigns.push({
    id: newId<'ProductCampaign'>(),
    productId: f.product.id,
    ideaId: newId<'ProductIdea'>(),
    projectId: newId<'Project'>(),
    conversationId: null,
    revision: 1,
    status: 'draft',
    createdAt: 1000,
    updatedAt: 1000,
  });
  expect(await f.service.choose(f.product.id, ideas[0]!.id)).toMatchObject({
    ok: false,
    error: { code: 'agent.product_draft_limit' },
  });
  f.deps.model.shortlist = vi.fn(async () => {
    f.product.revision += 1;
    return ok([]);
  });
  expect(await f.service.research(f.product.id)).toMatchObject({
    ok: false,
    error: { code: 'agent.product_evidence_changed' },
  });
});

it('deduplicates concurrent research and stops archived or cancelled products before model calls', async () => {
  const f = productFixture();
  const [a, b] = await Promise.all([f.service.research(f.product.id), f.service.research(f.product.id)]);
  expect(a).toEqual(b);
  expect(f.deps.model.shortlist).toHaveBeenCalledTimes(1);
  f.product.archivedAt = 1000;
  expect(await f.service.research(f.product.id)).toMatchObject({
    ok: false,
    error: { code: 'agent.product_archived' },
  });
  f.product.archivedAt = null;
  expect(await f.service.research(f.product.id, AbortSignal.abort())).toMatchObject({
    ok: false,
    error: { code: 'core.cancelled' },
  });
});
