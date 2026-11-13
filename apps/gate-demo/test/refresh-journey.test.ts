// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { alignJourney } from '../scripts/refresh-journey';
import type { Interaction } from '../scripts/refresh-offers';

const interaction = (ask: number): Interaction => ({
  request: {
    method: 'POST',
    url: 'https://provider.invalid/v1/messages',
    match: `old-${ask}`,
    headers: { 'content-type': 'application/json' },
    body: { taalcut_ask: ask, max_tokens: 128, tools: [{ name: 'old' }], messages: ['old'] },
  },
  response: { status: 200, headers: { 'content-type': 'text/event-stream' }, chunks: [`title-${ask}`] },
});

it('aligns a permuted journey without changing tape order or original interactions', () => {
  const tape = [interaction(1), interaction(3), interaction(2)];
  const before = structuredClone(tape);
  const journey = [tape[0]!, tape[2]!, tape[1]!].map((row) => ({
    ...row,
    request: {
      ...row.request,
      match: 'new-offer-hash',
      body: { ...row.request.body, tools: [{ name: 'new' }], messages: ['current'] },
    },
  }));
  expect(alignJourney(tape, journey)).toEqual([0, 2, 1]);
  expect(tape).toEqual(before);
});

it.each([
  ['response bytes', (row: Interaction): unknown => (row.response.chunks = ['changed'])],
  ['response status', (row: Interaction): unknown => (row.response.status = 500)],
  ['response headers', (row: Interaction): unknown => (row.response.headers = {})],
  ['request headers', (row: Interaction): unknown => (row.request.headers = {})],
  ['request method', (row: Interaction): unknown => (row.request.method = 'GET')],
  ['request URL', (row: Interaction): unknown => (row.request.url += '/other')],
  ['non-tool input', (row: Interaction): unknown => (row.request.body!.max_tokens = 256)],
] as const)('refuses changed %s', (_name, change) => {
  const original = interaction(1);
  const derived = structuredClone(original);
  change(derived);
  expect(() => alignJourney([original], [derived])).toThrow('missing or ambiguous');
});

it('refuses missing, duplicate and ambiguous coverage', () => {
  const first = interaction(1);
  const second = interaction(2);
  expect(() => alignJourney([first, second], [first])).toThrow('count changed');
  expect(() => alignJourney([first, second], [first, first])).toThrow('repeats');
  expect(() => alignJourney([first, first], [first, first])).toThrow('ambiguous');
});
