// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// CVR2: a designed cover in the cover panel. Its words are its composition's variables, edited as a designed
// graphic's are; the designs it came with are one click apart; the frame control re-points its lead picture; and
// removing the design leaves a cover a person makes by hand.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CoverComposition, CoverSettings } from '@taalcut/core';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CoverCompositionFields,
  withComposition,
  withLeadFrame,
} from '../src/cards/cover-composition-fields';

const design = (entry: string, hash: string, idea: string): CoverComposition => ({
  entry,
  files: [{ path: entry, sha256: hash.repeat(64), bytes: 10 }],
  hash: hash.repeat(64),
  variables: [
    { type: 'text', name: 'headline', maxLength: 40, sample: 'North of nowhere' },
    { type: 'colour', name: 'accent', default: '#ffb347' },
  ],
  params: { headline: 'North of nowhere' },
  at: 1,
  pictures: [{ name: 'hero', source: { kind: 'frame', frame: 20 } }],
  idea,
});
const poster = design('poster/index.html', 'a', 'The sun is the only colour');
const split = design('split/index.html', 'b', 'Day 7, and the number is the headline');
/** A cover made by hand, with the values core's schema gives the fields a cover leaves out. */
const hand = (frame: number): CoverSettings => ({
  aspect: '9:16',
  source: { kind: 'frame', frame },
  archetype: 'minimal-frame',
  theme: 'golden-hour',
  textAlign: 'bottom-left',
  hookText: '',
  kickerText: '',
  statBadge: '',
});
const cover: CoverSettings & { composition: CoverComposition } = {
  ...hand(20),
  medium: 'footage',
  composition: poster,
  options: { set: 'run', designs: [poster, split] },
};

/** Core's rules for a designed cover (cover.ts): drawn by its composition alone, which is one of those offered. */
const designed = (after: CoverSettings) =>
  after.design === undefined &&
  after.composition !== undefined &&
  after.options?.designs.some((offered) => offered.hash === after.composition?.hash) === true;

const show = (onChange: (changes: Partial<CoverSettings>) => void, paused = false) =>
  render(
    <I18nProvider i18n={i18n}>
      <CoverCompositionFields cover={cover} paused={paused} onChange={onChange} />
    </I18nProvider>,
  );

describe('a designed cover in the cover panel (CVR2)', () => {
  it('edits its words as a designed graphic’s, in the design in use and among the ones offered', async () => {
    const change = vi.fn();
    const view = show(change);
    expect(view.getByText('The sun is the only colour')).toBeTruthy();
    const words = view.getByDisplayValue('North of nowhere');
    fireEvent.change(words, { target: { value: 'South of somewhere' } });
    fireEvent.blur(words);
    await waitFor(() => expect(change).toHaveBeenCalled());
    const changes = change.mock.lastCall![0] as Partial<CoverSettings>;
    expect(changes.composition?.params).toEqual({ headline: 'South of somewhere' });
    // The design in use and its copy among the options stay the same design.
    expect(changes.options?.designs[0]?.params).toEqual({ headline: 'South of somewhere' });
    expect(changes.options?.designs[1]).toEqual(split);
    expect(designed({ ...cover, ...changes })).toBe(true);
  });

  it('offers the designs it came with, the one in use pressed, and swaps another in', () => {
    const change = vi.fn();
    const view = show(change);
    const [first, second] = view.getAllByRole('button', { name: /^Design \d$/ });
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(second?.getAttribute('title')).toBe('Day 7, and the number is the headline');
    fireEvent.click(second!);
    const changes = change.mock.lastCall![0] as Partial<CoverSettings>;
    expect(changes.composition).toEqual(split);
    expect(designed({ ...cover, ...changes })).toBe(true);
  });

  it('removes the design, leaving the frame for a cover made by hand', () => {
    const change = vi.fn();
    const view = show(change);
    fireEvent.click(view.getByRole('button', { name: 'Remove design' }));
    const changes = change.mock.lastCall![0] as Partial<CoverSettings>;
    expect(changes).toEqual({ composition: undefined, options: undefined, medium: undefined });
    // As it is stored: a cover made by hand on the same frame, with nothing of the design left.
    const stored = JSON.parse(JSON.stringify({ ...cover, ...changes }));
    expect(stored).toEqual(hand(20));
  });

  it('re-points a designed cover’s lead picture with the frame control, and a hand-made cover’s source', () => {
    const moved = withLeadFrame(cover, 45);
    expect(moved.source).toEqual({ kind: 'frame', frame: 45 });
    expect(moved.composition?.pictures).toEqual([{ name: 'hero', source: { kind: 'frame', frame: 45 } }]);
    expect(moved.options?.designs[0]?.pictures[0]?.source).toEqual({ kind: 'frame', frame: 45 });
    expect(withLeadFrame(hand(3), 45)).toEqual({ source: { kind: 'frame', frame: 45 } });
    // A design that draws no picture has no lead to follow.
    expect(withComposition(cover, { ...poster, pictures: [] }).source).toEqual({ kind: 'solid' });
  });

  it('holds its controls while the editor is paused', () => {
    const view = show(vi.fn(), true);
    for (const button of view.getAllByRole('button'))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
