// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { hubSubmissionResponseSchema } from '@taalcut/core/hub';
import { describe, expect, it } from 'vitest';

import { createTestHub, expectNoCors, type TestHub } from './harness';
import { HUB_ID, INSTALL_A, makeTemplate } from './template';

async function submitted(hub: TestHub): Promise<{ submissionId: string; pullRequest: number }> {
  const response = await hub.request('https://hub.example/v0/submissions', {
    method: 'POST',
    body: JSON.stringify({ installKey: INSTALL_A, template: makeTemplate() }),
  });
  return hubSubmissionResponseSchema.parse(await response.json());
}

function state(hub: TestHub, id: string, ip = '203.0.113.9'): Promise<Response> {
  return hub.request(`https://hub.example/v0/submissions/${id}`, { headers: { 'cf-connecting-ip': ip } });
}

describe('submission state', () => {
  it('caches GitHub state for five minutes and does not store the IP', async () => {
    let now = 1_800_000_000_000;
    const hub = createTestHub({ now: () => now });
    const created = await submitted(hub);
    hub.github.markMerged(created.pullRequest);
    const got = await state(hub, created.submissionId);
    expect(await got.json()).toEqual({ state: 'merged' });
    expectNoCors(got);
    await state(hub, created.submissionId);
    expect(hub.github.stateReads).toBe(1);
    now += 5 * 60 * 1000;
    await state(hub, created.submissionId);
    expect(hub.github.stateReads).toBe(2);
    expect(JSON.stringify(hub.db.snapshot())).not.toContain('203.0.113.9');
  });

  it("reads hidden from the hub repository's moderation list", async () => {
    let now = 1_800_000_000_000;
    const hub = createTestHub({ now: () => now });
    const created = await submitted(hub);
    expect(await (await state(hub, created.submissionId)).json()).toEqual({ state: 'open' });
    hub.github.setHidden([HUB_ID]);
    now += 5 * 60 * 1000;
    expect(await (await state(hub, created.submissionId)).json()).toEqual({ state: 'hidden' });
    hub.github.setHidden([]);
    now += 5 * 60 * 1000;
    expect(await (await state(hub, created.submissionId)).json()).toEqual({ state: 'open' });
  });

  it('answers 404 for an unknown or malformed id and limits reads per IP', async () => {
    const hub = createTestHub({ readLimit: 2 });
    expect((await state(hub, 'not-a-ulid')).status).toBe(404);
    expect((await state(hub, '01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404);
    const limited = await state(hub, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'hub.rate_limited' });
    expect((await state(hub, '01ARZ3NDEKTSV4RRFFQ69G5FAV', '198.51.100.7')).status).toBe(404);
  });

  it('is 503 when GitHub is down and no list was read yet', async () => {
    const hub = createTestHub();
    const created = await submitted(hub);
    hub.github.failing.add('read');
    const response = await state(hub, created.submissionId);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'hub.github_unavailable' });
  });
});
