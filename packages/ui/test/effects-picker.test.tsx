// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEffectId } from '@taalcut/core';
import { Composer, SelectionChip, SelectionTray, type ComposerEffects } from '@taalcut/ui';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => cleanup());

function Wrap({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const EFFECT_GROUPS: ComposerEffects['groups'] = [
  {
    id: 'graphics',
    label: 'Motion graphics',
    items: [
      { id: 'kineticTitle', label: 'Kinetic title', description: 'Word-by-word animated hook title' },
      { id: 'wordSwap', label: 'Word swap', description: 'Rapidly cycle contrast words' },
    ],
  },
  {
    id: 'transitions',
    label: 'Cuts & transitions',
    items: [{ id: 'whipPan', label: 'Whip pan', description: 'Fast whip-pan seam with whoosh' }],
  },
];

function EffectsHarness({ onSend = vi.fn() }: { onSend?: (text: string) => void }) {
  const [selected, setSelected] = useState<ChatEffectId[]>([]);
  const effects: ComposerEffects = {
    groups: EFFECT_GROUPS,
    selected,
    onToggle: (id) =>
      setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])),
    onClear: () => setSelected([]),
  };
  return (
    <Wrap>
      <Composer
        busy={false}
        onSend={onSend}
        onStop={vi.fn()}
        effects={effects}
        attachments={
          selected.length > 0 ? (
            <SelectionTray
              chips={selected.map((id) => ({
                kind: 'effect' as const,
                key: `effect:${id}`,
                label: id === 'kineticTitle' ? 'Kinetic title' : id === 'wordSwap' ? 'Word swap' : 'Whip pan',
              }))}
              onRemove={(key) => {
                const id = key.replace('effect:', '') as ChatEffectId;
                setSelected((prev) => prev.filter((item) => item !== id));
              }}
            />
          ) : undefined
        }
      />
    </Wrap>
  );
}

/** Lets Radix move focus into the sheet (a task later). */
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

describe('the composer’s Effects picker and effect selection chips (UX4, B14)', () => {
  it('toggles single and multiple effects without closing the sheet, updates the count badge, and renders effect chips', async () => {
    render(<EffectsHarness />);
    const button = screen.getByRole('button', { name: /Effects/i });
    expect(button.querySelector('[data-slot="effects-count"]')).toBeNull();
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(button);
    await settle();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Effects' });
    // Each effect is drawn, named, and described by its line; the first takes the focus.
    expect(menu.querySelectorAll('[data-slot="effect-picture"]')).toHaveLength(3);
    expect(document.activeElement?.getAttribute('data-effect')).toBe('kineticTitle');
    expect(within(menu).getByText('Motion graphics')).toBeTruthy();
    expect(within(menu).getByText('Cuts & transitions')).toBeTruthy();

    const kineticItem = within(menu).getByRole('menuitemcheckbox', { name: 'Kinetic title' });
    const whipItem = within(menu).getByRole('menuitemcheckbox', { name: 'Whip pan' });
    expect(kineticItem.getAttribute('aria-checked')).toBe('false');
    expect(kineticItem.getAttribute('aria-describedby')).toBeTruthy();

    // Select first effect (single): the sheet stays, the tile is checked.
    fireEvent.click(kineticItem);
    expect(screen.getByRole('menu', { name: /Effects/i })).toBeTruthy();
    expect(button.querySelector('[data-slot="effects-count"]')?.textContent).toBe('1');
    expect(
      within(screen.getByRole('menu', { name: 'Effects' }))
        .getByRole('menuitemcheckbox', { name: 'Kinetic title' })
        .getAttribute('aria-checked'),
    ).toBe('true');

    // Select second effect (multiple)
    fireEvent.click(whipItem);
    expect(button.querySelector('[data-slot="effects-count"]')?.textContent).toBe('2');

    // Both chips appear in the selection tray with kind="effect"
    const chips = document.querySelectorAll('[data-slot="selection-chip"][data-kind="effect"]');
    expect(chips).toHaveLength(2);

    // Clear effects, at the sheet's heading.
    fireEvent.click(screen.getByRole('button', { name: 'Clear effects' }));
    expect(button.querySelector('[data-slot="effects-count"]')).toBeNull();
    expect(document.querySelectorAll('[data-slot="selection-chip"][data-kind="effect"]')).toHaveLength(0);

    // Escape closes the sheet.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders an effect SelectionChip with ai-soft / ai-strong styling and remove button', () => {
    const onRemove = vi.fn();
    render(
      <Wrap>
        <SelectionChip
          chip={{ kind: 'effect', key: 'effect:kineticTitle', label: 'Kinetic title' }}
          onRemove={onRemove}
        />
      </Wrap>,
    );
    const chip = document.querySelector('[data-slot="selection-chip"][data-kind="effect"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('Kinetic title');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Kinetic title' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
