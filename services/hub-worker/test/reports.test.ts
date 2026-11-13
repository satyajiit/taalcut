// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';

import { REPORTS_GLOBAL_PER_DAY, REPORTS_PER_DAY, utcDay } from '../src/limits/rate-limits';
import { takeDailyUnit } from '../src/store/d1-days';
import { createTestHub, type TestHub } from './harness';
import { HUB_ID, INSTALL_A, INSTALL_B } from './template';

function report(hub: TestHub, body: unknown): Promise<Response> {
  return hub.request('https://hub.example/v0/reports', { method: 'POST', body: JSON.stringify(body) });
}

describe('reports', () => {
  it('opens one issue and comments on the next report', async () => {
    const hub = createTestHub();
    const first = await report(hub, {
      installKey: INSTALL_A,
      hubId: HUB_ID,
      reason: 'spam',
      note: 'copied structure',
    });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ issue: 1 });
    const issue = hub.github.issues[0];
    expect(issue?.labels).toEqual(['report', `hub:${HUB_ID}`]);
    expect(issue?.title).toContain(HUB_ID);
    expect(issue?.body).toContain('spam');
    expect(issue?.body).toContain('`hidden`');
    expect(issue?.body).not.toContain(INSTALL_A);
    const second = await report(hub, { installKey: INSTALL_B, hubId: HUB_ID, reason: 'offensive' });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ issue: 1 });
    expect(hub.github.issues).toHaveLength(1);
    expect(hub.github.issues[0]?.comments).toEqual(['Another report: offensive.']);
    expect(hub.db.snapshot().reports).toHaveLength(2);
    expect(JSON.stringify(hub.db.snapshot())).not.toContain(INSTALL_B);
  });

  it('rejects a note that fails the content rules', async () => {
    const hub = createTestHub();
    const response = await report(hub, {
      installKey: INSTALL_A,
      hubId: HUB_ID,
      reason: 'other',
      note: 'see https://evil.example',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'hub.invalid', problems: [{ path: 'note', rule: 'url' }] });
    expect(hub.github.issues).toHaveLength(0);
  });

  it('caps reports per install and in all', async () => {
    const day = utcDay(Date.now());
    const hub = createTestHub();
    for (let index = 0; index < REPORTS_PER_DAY; index += 1) {
      expect((await report(hub, { installKey: INSTALL_A, hubId: HUB_ID, reason: 'spam' })).status).toBe(202);
    }
    const limited = await report(hub, { installKey: INSTALL_A, hubId: HUB_ID, reason: 'spam' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'hub.rate_limited' });

    const flooded = createTestHub();
    for (let index = 0; index < REPORTS_GLOBAL_PER_DAY; index += 1) {
      await takeDailyUnit(flooded.db, 'report:*', day, REPORTS_GLOBAL_PER_DAY);
    }
    const busy = await report(flooded, { installKey: INSTALL_B, hubId: HUB_ID, reason: 'spam' });
    expect(busy.status).toBe(429);
    expect(await busy.json()).toMatchObject({ code: 'hub.busy' });
    expect(flooded.github.issues).toHaveLength(0);
  });

  it('is 503 when GitHub refuses the issue, and records nothing', async () => {
    const hub = createTestHub();
    hub.github.failing.add('issue');
    const response = await report(hub, { installKey: INSTALL_A, hubId: HUB_ID, reason: 'copyright' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'hub.github_unavailable' });
    expect(hub.db.snapshot().reports).toHaveLength(0);
  });
});
