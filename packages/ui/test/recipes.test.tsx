// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An empty state's recipe chips (P3-V11): at most three, named as a group, a pick handed to the host. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Scissors } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { MAX_RECIPE_CHIPS, RecipeChips, type RecipeItem } from '../src/index';

const ITEMS: readonly RecipeItem[] = [
  { id: 'cut.newReel', label: 'Make a 15-second reel', icon: Scissors },
  { id: 'captions.newReel', label: 'A reel with captions' },
  { id: 'export.newHooks', label: 'Try three hooks' },
  { id: 'cut.tighten', label: 'Tighten the cut' },
];

describe('RecipeChips', () => {
  it('shows at most three, as buttons in a named group that wraps', () => {
    render(<RecipeChips items={ITEMS} onPick={vi.fn()} label="Recipes" />);
    const group = screen.getByRole('group', { name: 'Recipes' });
    const chips = within(group).getAllByRole('button');
    expect(MAX_RECIPE_CHIPS).toBe(3);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Make a 15-second reel',
      'A reel with captions',
      'Try three hooks',
    ]);
    expect(group.className).toContain('flex-wrap');
    // The glyph is decoration: the words name the chip.
    expect(chips[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('hands the picked recipe to the host', () => {
    const onPick = vi.fn();
    render(<RecipeChips items={ITEMS} onPick={onPick} label="Recipes" />);
    fireEvent.click(screen.getByRole('button', { name: 'A reel with captions' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('captions.newReel');
  });

  it('draws nothing when no recipe fits, and passes nothing on while disabled', () => {
    const onPick = vi.fn();
    const { container, rerender } = render(<RecipeChips items={[]} onPick={onPick} label="Recipes" />);
    expect(container.childElementCount).toBe(0);
    rerender(<RecipeChips items={ITEMS} onPick={onPick} label="Recipes" disabled />);
    const chip = screen.getByRole('button', { name: 'Try three hooks' });
    expect(chip).toHaveProperty('disabled', true);
    fireEvent.click(chip);
    expect(onPick).not.toHaveBeenCalled();
  });
});
