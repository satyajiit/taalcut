// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-K2: `sfx.searchSounds`' result card. Its output maps onto core's `soundResults` card: each sound named the
 * way its source names it, hints without a verdict, D23's borderline, the licence of a bundled sound and a fitted
 * bank sound's credit from the bank; a row the card can't carry is left off; a spilled output has no card.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cardSchema, newId, ok, parseCard, unwrap, type ToolCardContext } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SoundSearcher } from '../../src/listen/search/sound-search';
import { searchSoundsCard, type FoundSound } from '../../src/tools/sfx-search-card';
import { searchSoundsTool } from '../../src/tools/sfx-search-tool';
import { bankCatalogue, bankItem, fitItem, writeCatalogue } from '../sfx-bank-helpers';

const ctx: ToolCardContext = {
  runId: newId<'AgentRun'>(),
  toolCallId: newId<'ToolRun'>(),
  projectId: null,
  signal: new AbortController().signal,
};
const assetId = newId<'Asset'>();

const sound = (patch: Partial<FoundSound> & Pick<FoundSound, 'source'>): FoundSound => ({
  title: 'A sound',
  family: 'whoosh',
  z: 3.1,
  verdict: 'strong',
  borderline: false,
  ...patch,
});

const FOUND: readonly FoundSound[] = [
  sound({ source: 'bank', soundId: 'whoosh_fast/crisp', title: 'Whoosh fast, crisp', licence: 'MIT' }),
  sound({
    source: 'bank',
    soundId: 'fit/tick_domino',
    title: 'Tick domino',
    family: 'hit',
    verdict: 'plausible',
    borderline: true,
    z: 2.58,
    licence: 'CC0-1.0',
  }),
  sound({
    source: 'pack',
    packItemId: 'impact-soft',
    title: 'Soft impact',
    family: 'impact',
    licence: 'CC0-1.0',
  }),
  sound({ source: 'library', assetId, title: 'my-pop.wav', family: null, verdict: null, z: 0.4 }),
];

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'taalcut-sound-card-'));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('the soundResults card of sfx.searchSounds (EAR1-K2)', () => {
  it('maps the output onto a card that parses, in the same order', () => {
    const credits: Record<string, string> = { 'fit/tick_domino': '"Domino pieces hit" by Macif (CC0 1.0)' };
    const card = searchSoundsCard({ query: 'a fast whoosh', sounds: FOUND }, ctx, (id) => credits[id]);
    expect(unwrap(parseCard(JSON.parse(JSON.stringify(card))))).toEqual(card);
    expect(card).toMatchObject({
      type: 'soundResults',
      id: `sound-results:${ctx.toolCallId}`,
      version: 1,
      runId: ctx.runId,
      query: 'a fast whoosh',
    });
    expect(card.sounds).toEqual([
      {
        source: 'bank',
        soundId: 'whoosh_fast/crisp',
        title: 'Whoosh fast, crisp',
        family: 'whoosh',
        verdict: 'strong',
        z: 3.1,
        licence: 'MIT',
      },
      {
        source: 'bank',
        soundId: 'fit/tick_domino',
        title: 'Tick domino',
        family: 'hit',
        verdict: 'plausible',
        borderline: true,
        z: 2.58,
        licence: 'CC0-1.0',
        credit: '"Domino pieces hit" by Macif (CC0 1.0)',
      },
      {
        source: 'pack',
        packItemId: 'impact-soft',
        title: 'Soft impact',
        family: 'impact',
        verdict: 'strong',
        z: 3.1,
        licence: 'CC0-1.0',
      },
      // A hint has no verdict; the user's own sound carries no licence.
      { source: 'library', assetId, title: 'my-pop.wav', family: null, verdict: null, z: 0.4 },
    ]);
  });

  it('leaves off a row the card cannot carry, and shortens a long name', () => {
    const card = searchSoundsCard(
      {
        query: 'a pop',
        sounds: [
          sound({ source: 'library', assetId: 'mine', title: 'mine.wav' }),
          sound({ source: 'bank', title: 'No id' }),
          sound({ source: 'library', assetId, title: `${'long '.repeat(40)}.wav`, family: null, z: 250 }),
        ],
      },
      ctx,
    );
    expect(card.sounds).toHaveLength(1);
    expect(card.sounds[0]?.title).toHaveLength(120);
    expect(card.sounds[0]?.title.endsWith('…')).toBe(true);
    expect(card.sounds[0]?.z).toBe(100);
    expect(cardSchema.safeParse(card).success).toBe(true);
  });

  it('is the tool’s resultCard, with the credit read from the installed bank; a spilled output has none', async () => {
    await writeCatalogue(scratch, bankCatalogue([bankItem(), fitItem()]));
    const searcher: SoundSearcher = { search: async () => ok({ query: '', hits: [] }) as never };
    const tool = searchSoundsTool({ searcher, bankDir: () => scratch });
    const output = { query: 'a tick', hint: false, sounds: FOUND.slice(0, 2), skipped: [] };
    const card = unwrap(await tool.resultCard!(output, ctx));
    expect(card?.type === 'soundResults' && card.sounds.map((s) => s.credit)).toEqual([
      undefined,
      fitItem().credit,
    ]);
    const artifact = { id: newId<'Artifact'>(), mediaType: 'application/json', bytes: 9000, summary: 'x' };
    const spilled = { artifact, summary: 'x' };
    expect(unwrap(await tool.resultCard!(spilled, ctx))).toBeUndefined();
    // Without the bank (not installed yet) the card still shows, without credits.
    const bare = searchSoundsTool({ searcher, bankDir: () => null });
    const plain = unwrap(await bare.resultCard!(output, ctx));
    expect(plain?.type === 'soundResults' && plain.sounds.every((s) => s.credit === undefined)).toBe(true);
  });
});
