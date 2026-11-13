// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { hubRatingsSchema } from '@taalcut/core/hub';
import { describe, expect, it } from 'vitest';

import { createTestHub, expectNoCors, type TestHub } from './harness';
import { HUB_ID, INSTALL_A, INSTALL_B, OTHER_HUB_ID } from './template';

function rate(hub: TestHub, hubId: string, stars: number, installKey: string): Promise<Response> {
  return hub.request(`https://hub.example/v0/ratings/${hubId}`, {
    method: 'PUT',
    body: JSON.stringify({ installKey, stars }),
  });
}

async function aggregate(hub: TestHub): Promise<Record<string, unknown>> {
  const response = await hub.request('https://hub.example/v0/ratings');
  expect(response.status).toBe(200);
  return hubRatingsSchema.parse(await response.json()).ratings;
}

describe('ratings', () => {
  it('keeps one rating per install and updates it', async () => {
    const hub = createTestHub();
    const first = await rate(hub, HUB_ID, 5, INSTALL_A);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ count: 1, mean: 5 });
    const updated = await rate(hub, HUB_ID, 3, INSTALL_A);
    expect(await updated.json()).toEqual({ count: 1, mean: 3 });
    expect(await (await rate(hub, HUB_ID, 5, INSTALL_B)).json()).toEqual({ count: 2, mean: 4 });
    const withdrawn = await hub.request(`https://hub.example/v0/ratings/${HUB_ID}`, {
      method: 'DELETE',
      body: JSON.stringify({ installKey: INSTALL_A }),
    });
    expect(await withdrawn.json()).toEqual({ count: 1, mean: 5 });
    const response = await hub.request('https://hub.example/v0/ratings');
    expect(response.headers.get('cache-control')).toBe('public, max-age=600');
    expectNoCors(response);
    expect(hubRatingsSchema.parse(await response.json()).ratings[HUB_ID]).toEqual({ count: 1, mean: 5 });
    expect(hub.db.snapshot().ratings).toHaveLength(1);
    expect(JSON.stringify(hub.db.snapshot())).not.toContain(INSTALL_A);
  });

  it('refuses stars outside 1 to 5 and a malformed hub id', async () => {
    const hub = createTestHub();
    expect((await rate(hub, HUB_ID, 6, INSTALL_A)).status).toBe(400);
    expect((await rate(hub, HUB_ID, 0, INSTALL_A)).status).toBe(400);
    expect((await rate(hub, HUB_ID.toLowerCase(), 4, INSTALL_A)).status).toBe(400);
    expect(hub.db.snapshot().ratings).toHaveLength(0);
  });

  it('refuses and omits a template the hub repository lists as hidden, and restores it', async () => {
    let now = 1_800_000_000_000;
    const hub = createTestHub({ now: () => now });
    expect((await rate(hub, HUB_ID, 4, INSTALL_A)).status).toBe(200);
    expect((await rate(hub, OTHER_HUB_ID, 2, INSTALL_B)).status).toBe(200);
    hub.github.setHidden([HUB_ID]);
    now += 5 * 60 * 1000;
    const hidden = await rate(hub, HUB_ID, 4, INSTALL_B);
    expect(hidden.status).toBe(409);
    expect(await hidden.json()).toEqual({ code: 'hub.hidden' });
    const ratings = await aggregate(hub);
    expect(ratings[HUB_ID]).toBeUndefined();
    expect(ratings[OTHER_HUB_ID]).toEqual({ count: 1, mean: 2 });
    hub.github.setHidden([]);
    now += 5 * 60 * 1000;
    expect((await aggregate(hub))[HUB_ID]).toEqual({ count: 1, mean: 4 });
  });

  it('reads the hidden list once per five minutes and falls back to the last list when GitHub fails', async () => {
    let now = 1_800_000_000_000;
    const hub = createTestHub({ now: () => now });
    hub.github.setHidden([HUB_ID]);
    await aggregate(hub);
    await aggregate(hub);
    expect(hub.github.fileReads).toBe(1);
    hub.github.failing.add('read');
    now += 5 * 60 * 1000;
    expect((await rate(hub, HUB_ID, 3, INSTALL_A)).status).toBe(409);
  });

  it('answers 503 with no hidden list to go on', async () => {
    const hub = createTestHub();
    hub.github.failing.add('read');
    const refused = await rate(hub, HUB_ID, 3, INSTALL_A);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ code: 'hub.github_unavailable' });
    expect((await hub.request('https://hub.example/v0/ratings')).status).toBe(503);
    expect(hub.db.snapshot().ratings).toHaveLength(0);
  });

  it('burst-limits ratings per install', async () => {
    const hub = createTestHub({ rateLimit: 10 });
    for (let stars = 0; stars < 10; stars += 1) {
      expect((await rate(hub, HUB_ID, (stars % 5) + 1, INSTALL_A)).status).toBe(200);
    }
    const blocked = await rate(hub, HUB_ID, 1, INSTALL_A);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'hub.rate_limited', retryAfterSeconds: 60 });
    expect((await rate(hub, HUB_ID, 1, INSTALL_B)).status).toBe(200);
  });
});
