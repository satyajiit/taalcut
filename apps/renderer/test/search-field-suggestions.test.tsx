// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: the search field with suggestions (the Templates page's search by meaning): a combobox whose panel opens
 * while it has focus; ↓ and ↑ move through the results and wrap, Return opens the active one, Escape closes the panel
 * first and clears the words after. Without suggestions (the hub) it stays a plain search field.
 */
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SearchField } from '../src/features/templates/search-field';
import {
  SearchSuggestionsContext,
  type SearchPanelProps,
  type SearchSuggestions,
} from '../src/features/templates/search/search-suggestions';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

const NAMES = ['Beach day', 'Coffee by the sea'];

function Panel({ listId, optionId, active, onActive }: SearchPanelProps) {
  return (
    <ul role="listbox" id={listId} aria-label="Results">
      {NAMES.map((name, index) => (
        <li
          key={name}
          role="option"
          id={optionId(index)}
          aria-selected={active === index}
          onMouseMove={() => onActive(index)}
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

/** The field with its words in state, under these suggestions (none: the hub's plain field). */
function Harness({ suggestions, initial }: { suggestions: SearchSuggestions | null; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchSuggestionsContext.Provider value={suggestions}>
      <SearchField label="Search your templates" placeholder="Find" value={value} onChange={setValue} />
    </SearchSuggestionsContext.Provider>
  );
}

const renderField = (suggestions: SearchSuggestions | null, initial = '') =>
  render(
    <I18nProvider i18n={i18n}>
      <Harness suggestions={suggestions} initial={initial} />
    </I18nProvider>,
  );

function show(choose = vi.fn()) {
  renderField({ count: NAMES.length, choose, panel: (props) => <Panel {...props} /> });
  return { choose, field: screen.getByRole('combobox', { name: 'Search your templates' }) };
}

const selected = () => screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected'));

describe('the search field with suggestions', () => {
  it('opens its panel on focus and ties it to the field', () => {
    const { field } = show();
    expect(field.getAttribute('aria-expanded')).toBe('false');
    fireEvent.focus(field);
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(field.getAttribute('aria-autocomplete')).toBe('list');
  });

  it('ties the field to the panel itself while it has no results (a hint, bones, an error)', () => {
    renderField({ count: 0, choose: vi.fn(), panel: () => <p>Searching</p> });
    const field = screen.getByRole('combobox', { name: 'Search your templates' });
    fireEvent.focus(field);
    const controls = field.getAttribute('aria-controls') ?? '';
    expect(document.getElementById(controls)?.textContent).toBe('Searching');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('moves through the results with the arrows, wrapping, and opens the active one on Return', () => {
    const { field, choose } = show();
    fireEvent.change(field, { target: { value: 'sea' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(selected()).toEqual(['true', 'false']);
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id);
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(selected()).toEqual(['true', 'false']);
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(selected()).toEqual(['false', 'true']);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(choose).toHaveBeenCalledWith(1);
  });

  it('closes the panel on the first Escape and clears the words on the second', () => {
    const { field } = show();
    fireEvent.change(field, { target: { value: 'sea' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((field as HTMLInputElement).value).toBe('sea');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('closes when focus leaves the field', () => {
    const { field } = show();
    fireEvent.focus(field);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.blur(field, { relatedTarget: document.body });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays a plain search field where nothing is suggested', () => {
    renderField(null, 'sea');
    const field = screen.getByRole('searchbox', { name: 'Search your templates' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-expanded')).toBeNull();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('');
  });
});
