// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- seeded memory: the creator's and the agent's own words */

/**
 * Settings → Memory's seed (LRN1-MEM): three things the creator wrote for every video, a decision the agent kept
 * for Golden hour market (the project), what worked with the Golden hour market template (learned from its
 * exports) and a note for Slow morning routine. Dated back from `now` so the page shows times, weekdays and dates.
 */
import { GOLDEN_PROJECT } from '../make/ids';
import { fakeUlid } from '../library/seed';
import { TEMPLATE_KIND } from '../templates/template-data';
import type { MemoryItem } from '@taalcut/core';

/** Memory items' fake ids (make/ids.ts uses 20 to 29). */
export const MEMORY_KIND = 30;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const GOLDEN_TEMPLATE = fakeUlid<'Template'>(TEMPLATE_KIND.template, 1);
export const MORNING_TEMPLATE = fakeUlid<'Template'>(TEMPLATE_KIND.template, 2);
type SeedItem = Pick<MemoryItem, 'scope' | 'text' | 'source'> & {
  readonly data?: MemoryItem['data'];
  readonly ago: number;
};

const SEED: readonly SeedItem[] = [
  { scope: { kind: 'user' }, text: 'Never use whip transitions.', source: 'user', ago: 2 * HOUR },
  {
    scope: { kind: 'user' },
    text: 'Captions in bold yellow, in the bottom third, never over faces.',
    source: 'user',
    ago: 1 * DAY + 3 * HOUR,
  },
  { scope: { kind: 'user' }, text: 'Keep intros under two seconds.', source: 'user', ago: 9 * DAY },
  {
    scope: { kind: 'project', projectId: GOLDEN_PROJECT },
    text: 'Open on the chai close-up, then cut to the market crowd on the first beat.',
    source: 'agent',
    ago: 3 * DAY,
  },
  {
    scope: { kind: 'template', templateId: GOLDEN_TEMPLATE },
    text:
      '“Golden hour market” (version 1) reached a finished export for Instagram Reels: 12 clips in 24 s, ' +
      "crossfade transitions, captions on, the platform's sound added later. Exported 2 times.",
    source: 'learned',
    data: {
      kind: 'what-worked',
      templateVersion: 1,
      styleId: null,
      presetId: 'reels',
      renderId: fakeUlid<'Render'>(23, 1),
      exports: 2,
    },
    ago: 5 * DAY,
  },
  {
    scope: { kind: 'template', templateId: MORNING_TEMPLATE },
    text: 'Slow morning routine looks best with the warm film look and no zoom-ins.',
    source: 'agent',
    ago: 40 * DAY,
  },
];

export function memorySeed(now: number): MemoryItem[] {
  return SEED.map(({ ago, ...item }, index) => ({
    id: fakeUlid<'MemoryItem'>(MEMORY_KIND, index + 1),
    scope: item.scope,
    text: item.text,
    source: item.source,
    data: item.data ?? null,
    conversationId: null,
    revision: 1,
    createdAt: now - ago,
    updatedAt: now - ago,
  }));
}
