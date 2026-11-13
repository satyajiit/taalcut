// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCassette } from '@taalcut/models';
import { expect, it } from 'vitest';
import {
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_SESSION,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_SESSION,
  MAKE_FLOW_SESSION,
} from '../src';

interface Interaction {
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; chunks: string[] };
}

const refresh = JSON.parse(readFileSync(join(GATE_DEMO_FIXTURES, 'catalogue-refresh.json'), 'utf8')) as {
  liveProviderCalls: number;
  sessions: Record<string, { recordedAt: string; interactionCount: number; responseSha256: string }>;
};

/** Catalogue updates must leave every stored wire request replayable, including sessions not run headlessly. */
it.each([GATE_DEMO_SESSION, MAKE_FLOW_SESSION, EDIT_CHAT_SESSION, EDIT_DESIGN_SESSION])(
  'preserves exact offline HTTP replay for every $name interaction',
  async (session) => {
    const path = join(GATE_DEMO_FIXTURES, session.cassette);
    const tape = JSON.parse(readFileSync(path, 'utf8')) as {
      recordedAt: string;
      interactions: Interaction[];
    };
    // Schema-only refreshes must preserve every reply, including the recorded invalid-call retry cases.
    const original = refresh.sessions[session.name]!;
    expect(refresh.liveProviderCalls).toBe(0);
    expect(tape.recordedAt).toBe(original.recordedAt);
    expect(tape.interactions).toHaveLength(original.interactionCount);
    expect(
      createHash('sha256')
        .update(JSON.stringify(tape.interactions.map((row) => row.response)))
        .digest('hex'),
    ).toBe(original.responseSha256);
    const cassette = openCassette({
      path,
      mode: 'replay',
      ignoreBodyFields: ['prompt_cache_key', 'metadata', 'user', 'session_id', 'system', 'messages'],
    });
    for (const row of tape.interactions) {
      const response = await cassette.fetch(row.request.url, {
        method: row.request.method,
        headers: row.request.headers,
        body: JSON.stringify(row.request.body),
      });
      expect(response.status).toBe(row.response.status);
      expect(await response.text()).toBe(row.response.chunks.join(''));
    }
    expect(cassette.misses()).toEqual([]);
    expect(cassette.unused()).toBe(0);
  },
);
