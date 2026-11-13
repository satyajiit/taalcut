// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { refreshMeta } from '../scripts/refresh-meta';
import type { Tape, WireTool } from '../scripts/refresh-offers';

const spec = (name: string, version: number): WireTool => ({ name, input_schema: { version } });
const tape = (): Tape => ({
  recordedAt: 'original',
  note: 'original',
  interactions: [0, 1].map((index) => ({
    request: {
      method: 'POST',
      url: '/messages',
      match: `original-${index}`,
      headers: {},
      body: {
        model: 'unchanged',
        tools: [
          spec('updatePlan', 1),
          { ...spec('startFlow', 1), cache_control: { type: 'ephemeral' } },
          spec('domain_tool', 1),
        ],
      },
    },
    response: { status: 200, headers: { original: 'yes' }, chunks: [`original-${index}`] },
  })),
});
const offers = () => ({
  0: [spec('updatePlan', 1), spec('startFlow', 2)],
  1: [spec('updatePlan', 1), spec('startFlow', 2)],
});

it('updates only captured meta definitions while retaining order, cache markers and all responses', () => {
  const before = tape(),
    after = structuredClone(before);
  expect(refreshMeta(after, offers())).toEqual([0, 1]);
  for (const row of after.interactions)
    row.request.body!.tools![1] = { ...row.request.body!.tools![1]!, input_schema: { version: 1 } };
  expect(after).toEqual(before);
});

it('refuses incomplete, extra or reordered meta offers before any mutation', () => {
  const before = tape();
  for (const invalid of [
    { 0: offers()[0] },
    { ...offers(), 2: offers()[0] },
    { ...offers(), 1: [...offers()[1]].reverse() },
    { ...offers(), 1: [spec('updatePlan', 1), spec('askUser', 1)] },
  ]) {
    const after = structuredClone(before);
    expect(() => refreshMeta(after, invalid)).toThrow(/meta offer/);
    expect(after).toEqual(before);
  }
});
