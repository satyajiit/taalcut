// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: a draft shot against its slot's needs, on made-up shots whose cosines are set exactly. A need is met by
 * the things the shot's words name, or by meaning above the pool's median; each verdict counts the other shots that
 * meet it, the ones a swap could bring in.
 */
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import type { SlotNeed } from '../src/casting/needs';
import { needVerdicts } from '../src/match/shot-needs';
import { DIMS, makeProfile, normalise } from './fixtures/library';

const terms = CASTING_CONFIG.terms;

function vector(cosine: number): Float32Array {
  const out = new Float32Array(DIMS);
  out[0] = cosine;
  out[1] = Math.sqrt(1 - cosine * cosine);
  return normalise(out);
}

const NEED_VECTOR = (() => {
  const out = new Float32Array(DIMS);
  out[0] = 1;
  return out;
})();

const need = (text: string, stems: readonly string[], vector: Float32Array | null): SlotNeed => ({
  text,
  stems,
  vector,
});

describe('needVerdicts', () => {
  const walking = makeProfile({ embedding: vector(0.2), description: 'A man walks down a busy street' });
  const phone = makeProfile({ embedding: vector(0.6), description: 'A man scrolls on his smartphone' });
  const bench = makeProfile({ embedding: vector(0.25), description: 'An empty bench in a park' });
  const pool = [walking, phone, bench];

  it('meets a need by the words the shot names', () => {
    const [verdict] = needVerdicts([need('a park bench', ['park', 'bench'], null)], bench, pool, terms);
    expect(verdict).toEqual({ text: 'a park bench', met: true, by: 'words', others: 0 });
  });

  it('meets a need by meaning when the shot sits above the pool median by the margin', () => {
    const phrase = need('person looking at a phone', ['phone'], NEED_VECTOR);
    expect(needVerdicts([phrase], phone, pool, terms)[0]).toMatchObject({ met: true, by: 'meaning' });
    // The walking shot is under the bar, and one other shot (the phone) meets the need: a swap candidate.
    expect(needVerdicts([phrase], walking, pool, terms)[0]).toEqual({
      text: 'person looking at a phone',
      met: false,
      by: null,
      others: 1,
    });
  });

  it('reads a need by its words only without a vector, and counts the shot once when the pool holds it', () => {
    const [verdict] = needVerdicts([need('a phone', ['phone'], null)], walking, [walking, walking], terms);
    expect(verdict).toEqual({ text: 'a phone', met: false, by: null, others: 0 });
  });

  it('leaves out shots without an embedding from the meaning test', () => {
    const bare = makeProfile({ embedding: new Float32Array(0), description: 'A dog' });
    const [verdict] = needVerdicts([need('a cat', ['cat'], NEED_VECTOR)], bare, [bare, phone], terms);
    expect(verdict?.met).toBe(false);
  });
});
