// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import migration from '../migrations/0001_init.sql?raw';
import worker from '../src/index';

async function applyMigration(): Promise<void> {
  const statements = migration
    .split(';')
    .map((part) => part.replace(/--[^\n]*/g, '').trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) await env.RATINGS.prepare(statement).run();
}

describe('worker pool', () => {
  it('routes health, size and schema checks, and a daily cap on Miniflare D1', async () => {
    await applyMigration();
    const count = z
      .object({ n: z.number() })
      .parse(await env.RATINGS.prepare('SELECT COUNT(*) AS n FROM owners').first());
    expect(count.n).toBe(0);

    const health = await worker.fetch(new Request('https://hub.example/v0/health'), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, formatVersion: 0 });
    expect(health.headers.get('access-control-allow-origin')).toBeNull();

    const oversized = await worker.fetch(
      new Request('https://hub.example/v0/submissions', {
        method: 'POST',
        body: new Uint8Array(256 * 1024 + 1),
      }),
      env,
    );
    expect(oversized.status).toBe(413);

    const invalid = await worker.fetch(
      new Request('https://hub.example/v0/submissions', {
        method: 'POST',
        body: JSON.stringify({ installKey: 'short', template: {} }),
      }),
      env,
    );
    expect(invalid.status).toBe(400);
    expect(z.object({ code: z.string() }).parse(await invalid.json()).code).toBe('hub.invalid');

    const take =
      'INSERT INTO day_counts (key, day, n) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n';
    const taken = [];
    for (let index = 0; index < 3; index += 1)
      taken.push(await env.RATINGS.prepare(take).bind('k', 'd', 2).first());
    expect(taken).toEqual([{ n: 1 }, { n: 2 }, null]);
  });
});
