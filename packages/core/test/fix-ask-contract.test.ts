// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK's contract: a gap the person's footage can't fill says what's wrong (the counts, what the shot asks for,
 * the closest clip, what the shot carries) and offers three more fixes: add clips, the clip from another shot (with
 * what that shot gets instead) and another part of a clip already used. The card says why the run asked, and the
 * answer names a borrowed or reused clip as it names a swap's. All additive: a card from before parses unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  GAP_ASK_REASONS,
  GAP_CARRIES,
  GAP_FIX_KINDS,
  GAP_OUTCOMES,
  newId,
  parseCard,
  questionAnswerSchema,
  RationalTime,
  FrameRates,
} from '@taalcut/core';
import { PHASE3_CARDS } from './helpers/phase3-cards';

const clip = (fit: number, description: string | null = 'Someone checks a phone on a bench') => ({
  assetId: newId<'Asset'>(),
  shotId: newId<'Shot'>(),
  description,
  fit,
});

const card = PHASE3_CARDS.gapFix;
const gap = card.gaps[0]!;
const borrow = {
  kind: 'borrow',
  candidates: [
    { ...clip(0.81), from: { gapId: newId<'TimelineItem'>(), number: 4, fit: 0.3 }, instead: clip(0.42) },
  ],
};
const reuse = {
  kind: 'reuse',
  candidates: [{ ...clip(0.6), usedIn: 2, sourceStart: RationalTime.of(240, FrameRates.fps30) }],
};

describe('FIX-ASK: the gapFix card says what is wrong', () => {
  it('names the three new fixes after the old ones', () => {
    expect(GAP_FIX_KINDS.slice(-3)).toEqual(['addClips', 'borrow', 'reuse']);
    expect(GAP_ASK_REASONS).toEqual(['empty', 'opening', 'carries', 'manyUnsure']);
    expect(GAP_CARRIES).toEqual(['text', 'graphics']);
    expect(GAP_OUTCOMES.slice(-2)).toEqual(['borrowed', 'reused']);
  });

  it('parses a card from before FIX-ASK unchanged', () => {
    expect(parseCard(card).ok).toBe(true);
  });

  it('carries the counts, what each shot wants, its closest clip, what it carries and why the run asks', () => {
    const parsed = parseCard({
      ...card,
      summary: { shots: 13, filled: 12, empty: 1, unsure: 2 },
      newClips: { added: 1, ready: 1, used: 0 },
      asking: { approvalId: 'ap-1', why: ['empty', 'opening'] },
      gaps: [
        {
          ...gap,
          wants: 'someone checking a phone',
          closest: { ...clip(0.81), usedIn: 4 },
          carries: ['text', 'graphics'],
          options: [{ kind: 'addClips' }, borrow, reuse, { kind: 'film' }],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it('keeps the new fields to their limits', () => {
    const one = (extra: Record<string, unknown>) => parseCard({ ...card, gaps: [{ ...gap, ...extra }] }).ok;
    expect(one({ wants: 'x'.repeat(121) })).toBe(false);
    expect(one({ carries: ['music'] })).toBe(false);
    expect(one({ closest: { ...clip(0.5), usedIn: 0 } })).toBe(false);
    expect(one({ options: [{ ...borrow, candidates: [] }] })).toBe(false);
    expect(
      one({ options: [{ ...borrow, candidates: [{ ...borrow.candidates[0], instead: undefined }] }] }),
    ).toBe(false);
    expect(one({ options: [{ ...reuse, candidates: Array(4).fill(reuse.candidates[0]) }] })).toBe(false);
    expect(parseCard({ ...card, summary: { shots: 0, filled: 0, empty: 0, unsure: 0 } }).ok).toBe(false);
    expect(parseCard({ ...card, asking: { approvalId: 'ap-1', why: ['bored'] } }).ok).toBe(false);
  });

  it("carries the fix Taalcut proposes, with a swap's, borrow's or reuse's clip", () => {
    const swapTo = { assetId: newId<'Asset'>(), shotId: null };
    const one = (proposed: unknown) => parseCard({ ...card, gaps: [{ ...gap, proposed }] }).ok;
    expect(one({ fix: 'borrow', swapTo })).toBe(true);
    expect(one({ fix: 'drop' })).toBe(true);
    expect(one({ fix: 'paint' })).toBe(false);
    expect(one({ fix: 'swap', swapTo: { assetId: 'nope', shotId: null } })).toBe(false);
  });

  it('answers a borrow or a reuse with the clip it takes, and add clips with nothing more', () => {
    const swapTo = { assetId: newId<'Asset'>(), shotId: newId<'Shot'>() };
    const answer = questionAnswerSchema.safeParse({
      kind: 'gapFix',
      fixes: [
        { gapId: newId<'TimelineItem'>(), fix: 'borrow', swapTo },
        { gapId: newId<'TimelineItem'>(), fix: 'reuse', swapTo },
        { gapId: newId<'TimelineItem'>(), fix: 'addClips' },
      ],
    });
    expect(answer.success).toBe(true);
  });
});
