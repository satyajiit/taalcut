// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ariaKeyShortcuts,
  CommandPalette,
  fuzzyMatch,
  fuzzyRank,
  matchesShortcut,
  parseShortcut,
  shortcutKeys,
  useCommandShortcuts,
  usePaletteShortcut,
  type PaletteItem,
} from '../src';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);

const key = (init: KeyboardEventInit & { key: string; code?: string }) => new KeyboardEvent('keydown', init);

describe('fuzzy search', () => {
  it('matches characters in order, case- and accent-insensitively', () => {
    expect(fuzzyMatch('gl', 'Go to Library')).not.toBeNull();
    expect(fuzzyMatch('gtl', 'Go to Library')?.indices).toEqual([0, 3, 6]);
    expect(fuzzyMatch('lg', 'Go to Library')).toBeNull();
    expect(fuzzyMatch('zz', 'Go to Library')).toBeNull();
    expect(fuzzyMatch('resume', 'Résumé')).not.toBeNull();
  });

  it('prefers word starts and runs, and falls back when a word-start jump would miss', () => {
    const items = [{ title: 'Toggle light' }, { title: 'Go to Library' }, { title: 'Settings' }];
    expect(fuzzyRank(items, 'lib').map((r) => r.item.title)[0]).toBe('Go to Library');
    expect(fuzzyMatch('ox', 'box o')?.indices).toEqual([1, 2]);
  });

  it('ranks the query in one piece first and highlights runs, never scattered letters', () => {
    const items = [
      { title: 'Use the recommended models', keywords: ['reset'] },
      { title: 'Use the light theme', keywords: ['appearance'] },
      { title: 'Appearance settings', keywords: ['theme'] },
    ];
    // Both theme items (by title, by keyword) before a title that merely holds t-h-e-m-e.
    expect(fuzzyRank(items, 'theme').map((r) => r.item.title)).toEqual([
      'Appearance settings',
      'Use the light theme',
      'Use the recommended models',
    ]);
    expect(fuzzyMatch('theme', 'Use the light theme')?.indices).toEqual([14, 15, 16, 17, 18]);
    // t-h-e from "the", then m and e on their own: only the run is highlighted.
    expect(fuzzyMatch('theme', 'Use the recommended models')?.indices).toEqual([4, 5, 6]);
    expect(fuzzyMatch('dark th', 'Use the dark theme')?.indices).toEqual([8, 9, 10, 11, 12, 13, 14]);
    // Each word starting a word, in order.
    expect(fuzzyMatch('use theme', 'Use the dark theme')?.indices).toEqual([0, 1, 2, 13, 14, 15, 16, 17]);
  });

  it('ranks title matches over keyword matches and keeps order for an empty query', () => {
    const items = [
      { title: 'Use the dark theme', keywords: ['appearance'] },
      { title: 'Appearance settings' },
    ];
    expect(fuzzyRank(items, 'appear').map((r) => r.item.title)).toEqual([
      'Appearance settings',
      'Use the dark theme',
    ]);
    expect(fuzzyRank(items, ' ').map((r) => r.item.title)).toEqual(items.map((i) => i.title));
  });
});

describe('shortcuts', () => {
  it('parses accelerators in any case and shows Mac glyphs', () => {
    expect(parseShortcut('Mod+Shift+Z')).toEqual({
      mod: true,
      shift: true,
      alt: false,
      ctrl: false,
      key: 'Z',
    });
    expect(shortcutKeys(parseShortcut('mod+shift+z'))).toEqual(['⇧', '⌘', 'Z']);
    expect(shortcutKeys(parseShortcut('enter'))).toEqual(['↩']);
    expect(ariaKeyShortcuts(parseShortcut('mod+,'))).toBe('Meta+,');
  });

  it('matches ⌘ or Ctrl for mod, by key or physical key, with exact modifiers', () => {
    const modK = parseShortcut('mod+k');
    expect(matchesShortcut(key({ key: 'k', code: 'KeyK', metaKey: true }), modK)).toBe(true);
    expect(matchesShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }), modK)).toBe(true);
    expect(matchesShortcut(key({ key: 'K', code: 'KeyK', metaKey: true, shiftKey: true }), modK)).toBe(false);
    expect(matchesShortcut(key({ key: 'k', code: 'KeyK' }), modK)).toBe(false);
    expect(
      matchesShortcut(
        key({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }),
        parseShortcut('mod+shift+1'),
      ),
    ).toBe(true);
  });
});

function items(run = vi.fn()): PaletteItem[] {
  return [
    { id: 'lib', title: 'Go to Library', group: 'Go to', shortcut: 'mod+2', run },
    { id: 'dark', title: 'Use the dark theme', group: 'Appearance', disabled: true, run },
    { id: 'light', title: 'Use the light theme', group: 'Appearance', command: 'settings.setTheme', run },
  ];
}

function Harness({ list, onOpenChange }: { list: PaletteItem[]; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <CommandPalette
      open={open}
      items={list}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    />
  );
}

describe('CommandPalette', () => {
  it('is a combobox over grouped options, with shortcuts and bus command names', () => {
    render(<Harness list={items()} />, { wrapper });
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeTruthy();
    const library = screen.getByRole('option', { name: /Go to Library/ });
    expect(library.getAttribute('aria-keyshortcuts')).toBe('Meta+2');
    expect(library.textContent).toContain('⌘');
    expect(screen.getByRole('option', { name: /light/ }).getAttribute('data-command')).toBe(
      'settings.setTheme',
    );
  });

  it('moves with the arrows, skips disabled options, and runs on Return', async () => {
    const run = vi.fn();
    const onOpenChange = vi.fn();
    render(<Harness list={items(run)} onOpenChange={onOpenChange} />, { wrapper });
    const input = screen.getByRole('combobox');
    const active = () =>
      document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(active()).toContain('Library');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toContain('light');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toContain('Library');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('filters as you type and says when nothing matches', () => {
    render(<Harness list={items()} />, { wrapper });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'light' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('light'),
    ]);
    fireEvent.change(input, { target: { value: 'qqq' } });
    expect(screen.getByRole('status').textContent).toContain('qqq');
  });

  it('says why a found item was found when its name isn’t what matched, the typed words marked', () => {
    const found: PaletteItem[] = [
      {
        id: 'clip.1',
        title: 'GX010610.MP4',
        group: 'Clips',
        scope: 'search',
        found: true,
        why: { kind: 'Said', passage: 'Okay, we just landed in Goa', marks: [[24, 27]] },
        run: vi.fn(),
      },
      { id: 'clip.2', title: 'Goa sunset.mov', group: 'Clips', scope: 'search', found: true, run: vi.fn() },
    ];
    render(<Harness list={found} />, { wrapper });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'goa' } });
    const said = screen.getByRole('option', { name: /GX010610/ });
    const named = screen.getByRole('option', { name: /Goa sunset/ });
    const why = said.querySelector<HTMLElement>('[data-slot=palette-why]')!;
    expect(why.textContent).toBe('Said · Okay, we just landed in Goa');
    expect(why.title).toBe('Okay, we just landed in Goa');
    expect(why.querySelector('mark')?.textContent).toBe('Goa');
    expect(why.querySelector('[data-user-content]')?.getAttribute('translate')).toBe('no');
    expect(named.querySelector('[data-slot=palette-why]')).toBeNull();
  });

  it('stays open and shows the error a command returns', async () => {
    const failing: PaletteItem = {
      id: 'x',
      title: 'Break',
      group: 'Test',
      run: async () => ({ error: 'It broke.' }),
    };
    const onOpenChange = vi.fn();
    render(<Harness list={[failing]} onOpenChange={onOpenChange} />, { wrapper });
    await act(async () => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }));
    expect(screen.getByRole('alert').textContent).toBe('It broke.');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

function ShortcutHost({ list, onToggle }: { list: PaletteItem[]; onToggle: () => void }) {
  useCommandShortcuts(list, { onTogglePalette: onToggle });
  return <input aria-label="field" />;
}

describe('useCommandShortcuts', () => {
  it('toggles the palette with ⌘K anywhere, and runs item shortcuts outside text fields', () => {
    const run = vi.fn();
    const onToggle = vi.fn();
    render(<ShortcutHost list={items(run)} onToggle={onToggle} />, { wrapper });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);

    const field = screen.getByRole('textbox', { name: 'field' });
    fireEvent.keyDown(field, { key: '2', code: 'Digit2', metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK', metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('splits ⌘K from the items: each part binds only its own keys', () => {
    const run = vi.fn();
    const onToggle = vi.fn();
    function Split() {
      usePaletteShortcut(onToggle);
      useCommandShortcuts(items(run));
      return null;
    }
    render(<Split />, { wrapper });
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives way to a dialog that shows, not to a closed native popover waiting in the page', () => {
    const run = vi.fn();
    const onToggle = vi.fn();
    render(<ShortcutHost list={items(run)} onToggle={onToggle} />, { wrapper });
    const press = () => {
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK', metaKey: true });
      fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true });
    };
    // The window bar's downloads popover is a dialog that stays in the page, hidden, until it opens.
    const popover = document.createElement('div');
    popover.setAttribute('popover', 'auto');
    popover.setAttribute('role', 'dialog');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    try {
      document.body.append(popover);
      press();
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(1);
      document.body.append(dialog);
      press();
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      popover.remove();
      dialog.remove();
    }
  });
});
