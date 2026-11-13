// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-LANG eval: how a run is judged, and the scenarios' priors and identifier. */
import { describe, expect, it } from 'vitest';
import type { EvidenceRow } from '../../src/language/evidence';
import { decide, judge } from '../../src/language/score';

const row = (whisper: Record<string, number>, pieces?: Record<string, number>): EvidenceRow => ({
  id: 'x',
  crop: 0,
  silent: false,
  whisper: Object.entries(whisper).map(([language, probability]) => ({ language, probability })),
  ...(pieces
    ? {
        pieces: [
          {
            startMs: 0,
            endMs: 6000,
            scores: Object.entries(pieces).map(([language, probability]) => ({ language, probability })),
          },
        ],
      }
    : {}),
  ms: 1,
});

describe('judge', () => {
  it('calls a named language right or wrong, unclear unclear, and a mix right only as the mix', () => {
    expect(judge({ language: 'or' }, { state: 'detected', languages: ['or'] })).toBe('right');
    expect(judge({ language: 'or' }, { state: 'detected', languages: ['ne'] })).toBe('wrong');
    expect(judge({ language: 'or' }, { state: 'unclear', languages: [] })).toBe('unclear');
    const hinglish = { language: 'hi', mix: ['hi', 'en'] };
    expect(judge(hinglish, { state: 'mixed', languages: ['en', 'hi'] })).toBe('right');
    expect(judge(hinglish, { state: 'detected', languages: ['hi'] })).toBe('right');
    expect(judge(hinglish, { state: 'detected', languages: ['en'] })).toBe('wrong');
    expect(judge({ language: 'hi' }, { state: 'mixed', languages: ['hi', 'en'] })).toBe('wrong');
  });
});

describe('decide', () => {
  const odia = row({ bn: 0.4 }, { or: 0.92, bn: 0.05, as: 0.03 });

  it('before: Whisper tiny’s first language, whatever its confidence', () => {
    expect(decide(odia, { language: 'or' }, 'before')).toEqual({ state: 'detected', languages: ['bn'] });
  });

  it('English only: no identifier, so Odia is unclear, never Bengali', () => {
    expect(decide(odia, { language: 'or' }, 'english')).toMatchObject({ state: 'unclear' });
  });

  it('with the clip’s language among the person’s: the identifier names Odia', () => {
    expect(decide(odia, { language: 'or' }, 'own')).toMatchObject({ state: 'detected', languages: ['or'] });
    expect(decide(odia, { language: 'or' }, 'indian')).toMatchObject({
      state: 'detected',
      languages: ['or'],
    });
  });
});
