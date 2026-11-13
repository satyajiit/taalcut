// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHubWorker } from '../src/index';
import { type HubEnv, type RateLimitBinding } from '../src/store/d1';
import { FakeGitHub } from './fake-github';
import { SqliteD1 } from './sqlite-d1';

export const TEST_SALT = 'test-salt-not-a-secret-0123456789abcdef';

export interface TestHub {
  env: HubEnv;
  db: SqliteD1;
  github: FakeGitHub;
  request(url: string, init?: RequestInit): Promise<Response>;
}

/** The ratelimits binding's contract: at most `limit` calls per key in any `periodMs`. */
export function createBurstLimiter(limit: number, periodMs: number, now: () => number): RateLimitBinding {
  const hits = new Map<string, number[]>();
  return {
    async limit({ key }) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < periodMs);
      const success = recent.length < limit;
      if (success) recent.push(at);
      hits.set(key, recent);
      return { success };
    },
  };
}

export function testEnv(
  db: SqliteD1,
  limits: { submit: number; rate: number; read: number },
  now: () => number,
): HubEnv {
  return {
    RATINGS: db,
    SUBMIT_BURST: createBurstLimiter(limits.submit, 10_000, now),
    RATE_BURST: createBurstLimiter(limits.rate, 60_000, now),
    READ_BURST: createBurstLimiter(limits.read, 60_000, now),
    HUB_REPO: 'taalcut/hub',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n',
    GITHUB_APP_ID: '1',
    GITHUB_APP_INSTALLATION_ID: '1',
    INSTALL_ID_SALT: TEST_SALT,
  };
}

/** A Worker over SQLite D1 and a fake hub repository; nothing leaves the process. */
export function createTestHub(options?: {
  submitLimit?: number;
  rateLimit?: number;
  readLimit?: number;
  now?: () => number;
}): TestHub {
  const db = new SqliteD1();
  const github = new FakeGitHub();
  const now = options?.now ?? (() => Date.now());
  const env = testEnv(
    db,
    { submit: options?.submitLimit ?? 100, rate: options?.rateLimit ?? 100, read: options?.readLimit ?? 100 },
    now,
  );
  const worker = createHubWorker({ github: () => github, now });
  return {
    env,
    db,
    github,
    request: (url, init) => worker.fetch(new Request(url, init), env),
  };
}

export function expectNoCors(response: Response): void {
  for (const [name] of response.headers) {
    if (name.toLowerCase().startsWith('access-control-')) {
      throw new Error(`unexpected CORS header ${name}`);
    }
  }
}
