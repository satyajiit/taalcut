// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX1 W2-1: the shared kit's data states. An error line is a line, not a washed box; an error or warning card is
// a decision card (raised, hairline, no shadow, 700 title) and drops its frame inside a dialog; stale content
// dims and says it is busy; Segmented glides on transform alone; ⌘K's empty list says what is empty.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { TaalcutError } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { splitCause } from '../src/feedback/error-card';
import {
  CommandPalette,
  ErrorCard,
  ErrorLine,
  memoryAcknowledgementStore,
  Segmented,
  StaleContent,
  Switch,
  WarningCard,
} from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const moved: TaalcutError = {
  code: 'core.not_found',
  messageKey: 'errors.core.not_found',
  retryable: false,
  params: { entity: 'source' },
  fix: { command: 'library.chooseFolder', labelKey: 'fix.chooseFolder' },
};

describe('splitCause', () => {
  it('makes the first sentence the title and the rest the body', () => {
    expect(splitCause('That folder is no longer here. It may have been moved or deleted.')).toEqual({
      title: 'That folder is no longer here.',
      body: 'It may have been moved or deleted.',
    });
    expect(splitCause('यह फ़ोल्डर अब यहाँ नहीं है। इसे हटा दिया गया होगा।')).toEqual({
      title: 'यह फ़ोल्डर अब यहाँ नहीं है।',
      body: 'इसे हटा दिया गया होगा।',
    });
  });

  it('keeps one sentence, and numbers with points, whole', () => {
    expect(splitCause('Stopped before it finished.')).toEqual({
      title: 'Stopped before it finished.',
      body: null,
    });
    expect(splitCause('Version 2.5 is too old')).toEqual({ title: 'Version 2.5 is too old', body: null });
  });
});

describe('ErrorLine', () => {
  it('is one line with the icon, the cause and its fix, on no wash and no edge', () => {
    const { container } = wrap(<ErrorLine error={moved} onFix={vi.fn()} />);
    const line = container.querySelector<HTMLElement>('[data-slot=error-line]');
    expect(line?.getAttribute('role')).toBe('alert');
    expect(line?.className).not.toMatch(/\bbg-|\bborder\b|rounded/);
    expect(line?.textContent).toContain('That folder is no longer here.');
    expect(screen.getByRole('button', { name: 'Choose another folder' })).toBeTruthy();
  });
});

describe('ErrorCard', () => {
  it('is a decision card: raised, a rule hairline, xl radius, no shadow or wash, the title at 700', () => {
    const { container } = wrap(<ErrorCard error={moved} onFix={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('[data-slot=error-card]');
    expect(card?.className).toContain('bg-raised');
    expect(card?.className).toContain('border-rule');
    expect(card?.className).toContain('rounded-xl');
    expect(card?.className).not.toMatch(/shadow-|bg-danger-soft/);
    expect(screen.getByText('That folder is no longer here.').className).toContain('font-bold');
  });

  it('takes a title of its own, with the whole message under it', () => {
    wrap(<ErrorCard error={moved} title="Couldn’t add the folder" />);
    expect(screen.getByText('Couldn’t add the folder').className).toContain('font-bold');
    expect(
      screen.getByText('That folder is no longer here. It may have been moved or deleted.'),
    ).toBeTruthy();
  });

  it('drops its frame inside a dialog, so it is never a card inside a card', () => {
    const { container } = wrap(<ErrorCard error={moved} />);
    const card = container.querySelector<HTMLElement>('[data-slot=error-card]');
    expect(card?.className).toContain('in-data-[slot=dialog-content]:border-0');
    expect(card?.className).toContain('in-data-[slot=dialog-content]:bg-transparent');
  });
});

describe('WarningCard', () => {
  it('is a decision card with a 700 title and no wash or shadow', async () => {
    const store = memoryAcknowledgementStore();
    const { container } = wrap(
      <WarningCard
        topic="test"
        termsVersion="1"
        store={store}
        title="Using your plan here"
        risk="The provider could limit your account."
        bearer="You do."
        saferAlternative={{ label: 'Use an API key instead', onSelect: vi.fn() }}
      />,
    );
    const heading = await screen.findByRole('heading', { name: 'Using your plan here' });
    expect(heading.className).toContain('font-bold');
    const card = container.querySelector<HTMLElement>('[data-slot=warning-card]');
    expect(card?.className).toContain('bg-raised');
    expect(card?.className).not.toMatch(/shadow-|bg-warning-soft/);
  });
});

describe('StaleContent', () => {
  it('dims after a moment and is busy while stale; plain when current', () => {
    const { container, rerender } = render(<StaleContent stale>rows</StaleContent>);
    const region = container.querySelector<HTMLElement>('[data-slot=stale-content]');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(region?.className).toContain('opacity-55');
    expect(region?.className).toContain('delay-150');
    rerender(<StaleContent stale={false}>rows</StaleContent>);
    expect(region?.hasAttribute('aria-busy')).toBe(false);
    expect(region?.className).not.toContain('opacity-55');
  });

  it('is busy but not dimmed while the same inputs are read again', () => {
    const { container } = render(
      <StaleContent stale={false} busy>
        rows
      </StaleContent>,
    );
    const region = container.querySelector<HTMLElement>('[data-slot=stale-content]');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(region?.className).not.toContain('opacity-55');
  });
});

describe('Switch', () => {
  it('has a real hover when on: the primary fill steps to primary-strong, a token that exists', () => {
    render(<Switch aria-label="Local only" checked onCheckedChange={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'Local only' });
    expect(toggle.className).toContain('hover:bg-primary-strong');
    expect(toggle.className).not.toContain('primary-hover');
  });
});

describe('Segmented', () => {
  it('draws its thumb from pieces that only ever transition transform', () => {
    const { container } = render(
      <Segmented
        label="Range"
        value="week"
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'This week' },
        ]}
        onChange={vi.fn()}
      />,
    );
    const pieces = container.querySelectorAll<HTMLElement>('[data-slot=segment-thumb] > span');
    expect(pieces).toHaveLength(3);
    for (const piece of pieces) {
      expect(piece.className).not.toMatch(/transition-\[|transition-all|transition-\w*width/);
      expect(piece.style.transform).toMatch(/^translate\(/);
    }
  });
});

describe('CommandPalette', () => {
  it('says there are no commands, not that nothing matches “”, when the list is empty', () => {
    wrap(<CommandPalette open onOpenChange={vi.fn()} items={[]} />);
    expect(screen.getByRole('status').textContent).toBe('There are no commands here yet.');
    expect(screen.queryByText(/No command matches/)).toBeNull();
  });

  it('gives the search field a focus line in place of a ring', () => {
    wrap(<CommandPalette open onOpenChange={vi.fn()} items={[]} />);
    const search = screen.getByRole('combobox');
    expect(search.className).toContain('outline-hidden');
    expect(search.closest('[data-slot=palette-search]')?.className).toContain(
      'has-[input:focus-visible]:after:opacity-100',
    );
  });
});
