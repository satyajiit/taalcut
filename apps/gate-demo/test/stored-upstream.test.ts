// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationTitler } from '@taalcut/agent';
import { ok } from '@taalcut/core';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createRecordedGateModels,
  GATE_DEMO_ASK,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_FOLLOW_UPS,
  GATE_DEMO_TITLE,
} from '../src';
import { storedUpstream } from '../src/stored-upstream';
import type { Tape } from '../scripts/refresh-offers';

const tape = JSON.parse(readFileSync(join(GATE_DEMO_FIXTURES, 'gate-demo.cassette.json'), 'utf8')) as Tape;
const scratch: string[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'taalcut-stored-upstream-'));
  scratch.push(path);
  return path;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

it('replays an appended title first, preserves its response, and refuses reuse or unknown requests', async () => {
  const fetch = storedUpstream(join(GATE_DEMO_FIXTURES, 'gate-demo.cassette.json'));
  const row = tape.interactions[25]!;
  const init = { method: row.request.method, body: JSON.stringify(row.request.body) };
  const reply = await fetch(row.request.url, init);
  expect(reply.status).toBe(row.response.status);
  expect(Object.fromEntries(reply.headers)).toEqual(row.response.headers);
  expect(await reply.text()).toBe(row.response.chunks.join(''));
  expect((await fetch(row.request.url, init)).status).toBe(400);
  expect((await fetch(`${row.request.url}/wrong`, init)).status).toBe(400);
  const first = tape.interactions[7]!;
  expect((await fetch(first.request.url, { ...init, body: JSON.stringify(first.request.body) })).status).toBe(
    200,
  );
});

it('refuses ambiguous matches even when their responses agree', async () => {
  const path = join(directory(), 'duplicate.json');
  const row = tape.interactions[7]!;
  writeFileSync(path, JSON.stringify({ interactions: [row, row] }));
  const reply = await storedUpstream(path)(row.request.url, {
    method: row.request.method,
    body: JSON.stringify(row.request.body),
  });
  expect(reply.status).toBe(400);
  expect(await reply.text()).toContain('ambiguous');
});

it('keeps ask/turn tags only for the stored-response upstream, never an explicit provider', async () => {
  vi.stubEnv('TAALCUT_RECORD_UPSTREAM', 'cassette');
  vi.stubEnv('TAALCUT_RECORD_DIR', directory());
  const rows: unknown[] = [];
  const stored = createRecordedGateModels(GATE_DEMO_FIXTURES, { home: '/Users/demo', mode: 'record' });
  const title = createConversationTitler(stored({ record: async () => ok(undefined) }).agent);
  // Reverse chronological order proves the actual adapter passes the title's ask identity through.
  for (const user of [GATE_DEMO_FOLLOW_UPS[0].ask, GATE_DEMO_ASK])
    expect(await title({ user, answer: 'Observed answer.' })).toBe(GATE_DEMO_TITLE);
  await stored.cassette.save();
  const explicit = createRecordedGateModels(GATE_DEMO_FIXTURES, {
    home: '/Users/demo',
    mode: 'record',
    upstream: async (_url, init) => {
      rows.push(JSON.parse(String(init?.body)));
      const response = tape.interactions[7]!.response;
      return new Response(response.chunks.join(''), { status: response.status, headers: response.headers });
    },
  });
  const providerTitle = createConversationTitler(explicit({ record: async () => ok(undefined) }).agent);
  expect(await providerTitle({ user: GATE_DEMO_ASK, answer: 'Observed answer.' })).toBe(GATE_DEMO_TITLE);
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty('taalcut_ask');
  expect(rows[0]).not.toHaveProperty('taalcut_turn');
  await explicit.cassette.save();
});
