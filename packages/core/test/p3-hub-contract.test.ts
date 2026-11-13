// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The hub namespace, its commands and its index (P3-B12, P3-V8). */
import { describe, expect, it } from 'vitest';
import {
  err,
  HUB_COMMANDS,
  HUB_HANDLE_SETTING,
  HUB_LICENCE_TERMS,
  hubBrowseQuerySchema,
  hubCommandPayloads,
  hubContract,
  hubIndexSchema,
  hubRouter,
  newId,
  NotFoundError,
  ok,
  type HubBrowseItem,
  type HubSubmissionView,
} from '@taalcut/core';
import { at, SHA } from './helpers/documents';
import { hubTemplate, serve } from './helpers/phase3';

const hubId = newId<'HubTemplate'>();
const templateId = newId<'Template'>();
const form = {
  name: 'Day one',
  description: '',
  handle: 'kaatu.cuts',
  tags: ['travel'],
  language: 'en',
  includeStyle: false,
};

const item: HubBrowseItem = {
  id: hubId,
  version: 1,
  name: 'Day one',
  description: 'Three cuts.',
  handle: 'kaatu.cuts',
  language: 'en',
  tags: ['travel'],
  formatId: 'vlog',
  trendFreshness: '2026-10-01',
  forkedFrom: null,
  duration: at(90),
  slotCount: 3,
  bpm: 120,
  slotStrip: [30, 30, 30],
  sha256: SHA,
  createdAt: 0,
  updatedAt: 0,
  rating: { count: 2, mean: 4.5 },
  forkedAs: null,
};

describe('hub index', () => {
  it('parses the index the hub repository builds', () => {
    const { rating: _rating, forkedAs: _forkedAs, ...entry } = item;
    expect(hubIndexSchema.safeParse({ formatVersion: 0, generatedAt: 0, templates: [entry] }).success).toBe(
      true,
    );
    expect(hubIndexSchema.safeParse({ formatVersion: 1, generatedAt: 0, templates: [] }).success).toBe(false);
    expect(
      hubIndexSchema.safeParse({
        formatVersion: 0,
        generatedAt: 0,
        templates: [{ ...entry, slotStrip: [0] }],
      }).success,
    ).toBe(false);
  });

  it('browses top rated first, 50 at a time', () => {
    expect(hubBrowseQuerySchema.parse({})).toEqual({ sort: 'topRated', limit: 50 });
    expect(hubBrowseQuerySchema.safeParse({ sort: 'popular' }).success).toBe(false);
    expect(hubBrowseQuerySchema.safeParse({ tags: Array(9).fill('a') }).success).toBe(false);
  });
});

describe('hub commands', () => {
  it('publishing needs the form and the CC0 acknowledgement', () => {
    const publish = hubCommandPayloads[HUB_COMMANDS.publish];
    const payload = { templateId, version: 2, form, acknowledgedAt: 1 };
    expect(publish.parse(payload).projectId).toBeNull();
    expect(publish.safeParse({ ...payload, acknowledgedAt: undefined }).success).toBe(false);
    expect(publish.safeParse({ ...payload, form: { ...form, handle: '' } }).success).toBe(false);
    expect(HUB_LICENCE_TERMS).toEqual({ featureId: 'hub.publish', termsVersion: '2026-10-14' });
  });

  it('fork, rate, report and openShare', () => {
    expect(
      hubCommandPayloads[HUB_COMMANDS.fork].safeParse({ hubId, version: 1, sha256: SHA, templateId }).success,
    ).toBe(true);
    expect(
      hubCommandPayloads[HUB_COMMANDS.fork].safeParse({ hubId, version: 1, sha256: 'x', templateId }).success,
    ).toBe(false);
    expect(hubCommandPayloads[HUB_COMMANDS.rate].safeParse({ hubId, stars: null }).success).toBe(true);
    expect(hubCommandPayloads[HUB_COMMANDS.rate].safeParse({ hubId, stars: 6 }).success).toBe(false);
    expect(hubCommandPayloads[HUB_COMMANDS.report].safeParse({ hubId, reason: 'spam' }).success).toBe(true);
    expect(
      hubCommandPayloads[HUB_COMMANDS.report].safeParse({ hubId, reason: 'spam', note: 'x'.repeat(501) })
        .success,
    ).toBe(false);
    expect(hubCommandPayloads[HUB_COMMANDS.openShare].safeParse({ templateId }).success).toBe(true);
    expect(HUB_HANDLE_SETTING).toMatchObject({ key: 'hub.handle', defaultValue: null });
  });
});

describe('hub namespace', () => {
  it('serves status, browse, a template, the share check and submissions', async () => {
    const submission: HubSubmissionView = {
      id: newId<'HubSubmission'>(),
      hubId,
      version: 1,
      templateId,
      templateVersion: 2,
      state: 'open',
      createdAt: 0,
      checkedAt: null,
    };
    const asked: unknown[] = [];
    const client = serve(
      hubContract,
      hubRouter({
        status: async () => ok({ configured: true, localOnly: false, indexFetchedAt: 0, templates: 1 }),
        browse: async (query) => (asked.push(query), ok({ items: [item], nextCursor: null })),
        get: async (id) =>
          id === hubId
            ? ok({ item, document: hubTemplate(), myRating: null })
            : err(NotFoundError({ entity: 'hubTemplate' })),
        shareCheck: async () =>
          ok({ document: null, problems: [{ path: 'name', rule: 'url', slotIndex: null, field: 'name' }] }),
        submissions: async (input) => (asked.push(input), ok([submission])),
      }),
    );
    expect((await client.status()).configured).toBe(true);
    expect((await client.browse({ query: 'goa' })).items).toHaveLength(1);
    expect((await client.get({ hubId })).document.format).toBe('taalcut.template');
    await expect(client.get({ hubId: newId<'HubTemplate'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    const check = await client.shareCheck({ templateId, version: 1, form });
    expect(check.problems[0]).toMatchObject({ rule: 'url', field: 'name' });
    expect(await client.submissions({})).toEqual([submission]);
    expect(asked).toEqual([{ query: 'goa', sort: 'topRated', limit: 50 }, { refresh: false }]);
  });
});
