// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-K2's card contract: `sfx.searchSounds`' soundResults card round-trips through storage and IPC, names each
 * sound the way its source does, keeps hints without a verdict, and holds at most 20 sounds.
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_TYPES,
  parseCard,
  SOUND_RESULT_SOURCES,
  SOUND_RESULTS_MAX,
  soundResultSchema,
  soundResultsCardSchema,
  unwrap,
} from '@taalcut/core';
import { json } from './helpers/documents';
import { SOUND_RESULTS_CARD } from './helpers/ear1-cards';

const [bank, fitted, pack, library] = SOUND_RESULTS_CARD.sounds as [
  (typeof SOUND_RESULTS_CARD.sounds)[number],
  (typeof SOUND_RESULTS_CARD.sounds)[number],
  (typeof SOUND_RESULTS_CARD.sounds)[number],
  (typeof SOUND_RESULTS_CARD.sounds)[number],
];

const issues = (value: unknown) => {
  const parsed = soundResultSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
};

describe('EAR1-K2: the soundResults card', () => {
  it('is a card type, and round-trips through JSON as parseCard reads it', () => {
    expect(CARD_TYPES).toContain('soundResults');
    expect(SOUND_RESULT_SOURCES).toEqual(['bank', 'pack', 'library']);
    expect(unwrap(parseCard(json(SOUND_RESULTS_CARD)))).toEqual(SOUND_RESULTS_CARD);
    const { runId: _runId, ...withoutRun } = SOUND_RESULTS_CARD;
    const empty = { ...withoutRun, sounds: [] };
    expect(soundResultsCardSchema.parse(json(empty))).toEqual(empty);
  });

  it('keeps a hint without a verdict, and borderline, licence and credit optional', () => {
    const hint = { ...bank, verdict: null, z: 0.4 };
    expect(soundResultSchema.parse(hint)).toEqual(hint);
    expect(soundResultSchema.parse(fitted)).toMatchObject({ borderline: true, credit: fitted.credit });
    const { licence: _licence, ...unlicensed } = pack;
    expect(issues(unlicensed)).toEqual([]);
  });

  it('names each sound the way its source does', () => {
    const { soundId: _soundId, ...noBankId } = bank;
    expect(issues(noBankId)).toEqual(['soundId']);
    const { packItemId: _packItemId, ...noPackId } = pack;
    expect(issues(noPackId)).toEqual(['packItemId']);
    const { assetId: _assetId, ...noAsset } = library;
    expect(issues(noAsset)).toEqual(['assetId']);
    expect(issues({ ...library, assetId: 'mine' })).toEqual(['assetId']);
    expect(issues({ ...library, licence: 'MIT' })).toEqual(['licence']);
    expect(issues({ ...bank, soundId: 'Cut Hit' })).toEqual(['soundId']);
  });

  it('refuses a bad verdict, family or licence, long text, and more than 20 sounds', () => {
    expect(issues({ ...bank, verdict: 'maybe' })).toEqual(['verdict']);
    expect(issues({ ...bank, family: 'boom' })).toEqual(['family']);
    expect(issues({ ...bank, licence: 'CC-BY-4.0' })).toEqual(['licence']);
    expect(issues({ ...bank, title: 'x'.repeat(121) })).toEqual(['title']);
    expect(issues({ ...fitted, credit: 'x'.repeat(301) })).toEqual(['credit']);
    const card = (patch: object) => parseCard({ ...SOUND_RESULTS_CARD, ...patch });
    expect(card({ query: 'x'.repeat(301) }).ok).toBe(false);
    expect(card({ query: '' }).ok).toBe(false);
    const many = Array.from({ length: SOUND_RESULTS_MAX + 1 }, () => bank);
    const tooMany = card({ sounds: many });
    expect(!tooMany.ok && tooMany.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'sounds' },
    });
    expect(card({ sounds: many.slice(1) }).ok).toBe(true);
  });
});
