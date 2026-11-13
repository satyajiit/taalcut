// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { act, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardView } from '../src/index';
import { installMatchMedia } from './media';
import { card, compareData, ORIGINAL, SECOND, THIRD, timelineAt, withPlayer } from './variants-fixture';

// Every media query matches here, so motion reads "reduce" the first time it asks (it remembers the answer for
// the whole file). Its own file for that reason.
beforeAll(() => installMatchMedia(true));

describe('variantsCompare under reduced motion', () => {
  beforeEach(() => installMatchMedia(true));

  it('shows posters only: no players, no transport, nothing plays', () => {
    vi.useFakeTimers();
    const renderPreview = vi.fn(() => null);
    withPlayer(
      <CardView card={card()} />,
      {},
      compareData([timelineAt(ORIGINAL, 3), timelineAt(SECOND), timelineAt(THIRD)], {}, { renderPreview }),
    );
    expect(screen.queryAllByTestId(/^player-/)).toHaveLength(0);
    expect(renderPreview).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-slot=variant-tile] [data-slot=shot-thumb]')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Play the hooks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play all' })).toBeNull();
    expect(screen.getByText('Posters only while reduced motion is on.')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(10_000));
    for (const tile of document.querySelectorAll<HTMLElement>('[data-slot=variant-tile]'))
      expect(tile.dataset.playing).toBe('false');
    vi.useRealTimers();
  });
});
