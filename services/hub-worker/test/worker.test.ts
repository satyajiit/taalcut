// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHubWorker } from '../src/index';
import { type D1Database } from '../src/store/d1';
import { FakeGitHub } from './fake-github';
import { createTestHub, testEnv } from './harness';
import { SqliteD1 } from './sqlite-d1';
import { HUB_ID, INSTALL_A } from './template';

afterEach(() => {
  vi.restoreAllMocks();
});

const LIMITS = { submit: 100, rate: 100, read: 100 };

describe('worker', () => {
  it('answers health, 404 for anything else, and sends no CORS headers', async () => {
    const hub = createTestHub();
    const health = await hub.request('https://hub.example/v0/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, formatVersion: 0 });
    for (const [url, method] of [
      ['https://hub.example/v0/nothing', 'GET'],
      ['https://hub.example/v0/health', 'POST'],
      ['https://hub.example/v0/ratings/%E0%A4%A', 'PUT'],
    ] as const) {
      const response = await hub.request(url, { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: 'hub.not_found' });
    }
  });

  it('is not configured without a usable secret, and never echoes one', async () => {
    const env = testEnv(new SqliteD1(), LIMITS, () => Date.now());
    const worker = createHubWorker({ github: () => new FakeGitHub() });
    for (const broken of [
      { ...env, INSTALL_ID_SALT: '' },
      { ...env, INSTALL_ID_SALT: 'short-salt' },
      { ...env, GITHUB_APP_PRIVATE_KEY: 'ghp_not_a_pem' },
      { ...env, HUB_REPO: 'not a repo' },
    ]) {
      const response = await worker.fetch(new Request('https://hub.example/v0/health'), broken);
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ code: 'hub.not_configured' });
      expect(text).not.toContain('ghp_');
    }
  });

  it('turns a database failure into 500 hub.busy and logs no body', async () => {
    const failing: D1Database = {
      prepare: () => {
        throw new Error(`D1_ERROR: ${INSTALL_A}`);
      },
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = { ...testEnv(new SqliteD1(), LIMITS, () => Date.now()), RATINGS: failing };
    const worker = createHubWorker({ github: () => new FakeGitHub() });
    const response = await worker.fetch(
      new Request(`https://hub.example/v0/ratings/${HUB_ID}`, {
        method: 'PUT',
        body: JSON.stringify({ installKey: INSTALL_A, stars: 4 }),
      }),
      env,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'hub.busy' });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(INSTALL_A);
  });
});
