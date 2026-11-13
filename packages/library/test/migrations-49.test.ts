// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index';
import { cloudCall } from './fixtures/records';
import { openTestDb } from './helpers';

describe('migration 49: cloud call billing', () => {
  it('keeps old billing unknown and round-trips subscription and API-key usage', () => {
    const db = openTestDb({ targetVersion: 48 });
    const oldId = newId<'CloudCall'>();
    db.driver
      .prepare(
        `INSERT INTO cloud_calls (id, module, provider, model, latency_ms, outcome, started_at)
      VALUES (?, 'images', 'xai', 'grok-imagine-image-2.0', 10, 'ok', 1)`,
      )
      .run(oldId);
    unwrap(db.migrateTo(49));
    const repos = createRepositories(db);
    expect(repos.cloudCalls.list()[0]).not.toHaveProperty('billing');
    const plan = cloudCall({ module: 'images', provider: 'xai', billing: 'subscription', costUsd: 0 });
    const api = cloudCall({ module: 'images', provider: 'xai', billing: 'apiKey', costUsd: 0.04 });
    unwrap(repos.cloudCalls.record(plan));
    unwrap(repos.cloudCalls.record(api));
    const rows = repos.cloudCalls.list();
    expect(rows.find((row) => row.id === plan.id)).toEqual(plan);
    expect(rows.find((row) => row.id === api.id)).toEqual(api);
    expect(() =>
      db.driver.prepare("UPDATE cloud_calls SET billing = 'free' WHERE id = ?").run(plan.id),
    ).toThrow();
    unwrap(db.migrateTo(48));
    unwrap(db.migrateTo(49));
    expect(repos.cloudCalls.list()).toHaveLength(3);
    expect(repos.cloudCalls.list().every((row) => row.billing === undefined)).toBe(true);
  });
});
