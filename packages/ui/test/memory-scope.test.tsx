// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a remembered item applies (LRN1-MEM): the field offers every video, a project or a template, a kind the
 * item can't take shown but disabled, and choosing a project or template opens the picker; the picker is a
 * combobox over a listbox (↑/↓/Home/End move, Return picks) that says when it loads, fails, is empty or matches
 * nothing.
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { TaalcutError } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryScopeField, MemoryScopePicker, type MemoryScopePickerProps } from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const OPTIONS = [
  { id: 'p1', name: 'Golden hour market' },
  { id: 'p2', name: 'Trip to Goa reel' },
  { id: 'p3', name: 'Monsoon in 60 seconds' },
];

function picker(overrides: Partial<MemoryScopePickerProps> = {}): MemoryScopePickerProps {
  return {
    kind: 'project',
    value: null,
    open: true,
    onOpenChange: vi.fn(),
    query: '',
    onQueryChange: vi.fn(),
    options: OPTIONS,
    onPick: vi.fn(),
    ...overrides,
  };
}

const timeout: TaalcutError = { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true };

describe('MemoryScopeField', () => {
  it('opens the picker on choosing a project, and leaves a kind the item cannot take disabled', () => {
    const onKindChange = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = wrap(
      <MemoryScopeField
        kind="user"
        onKindChange={onKindChange}
        disabledKinds={['template']}
        picker={{ ...picker({ open: false, onOpenChange }) }}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Applies to' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose a project' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'A template…' }).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'A project…' }));
    expect(onKindChange).toHaveBeenCalledWith('project');
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <I18nProvider i18n={i18n}>
        <MemoryScopeField
          kind="project"
          onKindChange={onKindChange}
          picker={{ ...picker({ open: false, onOpenChange }) }}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Choose a project' })).toBeTruthy();
  });
});

describe('MemoryScopePicker', () => {
  it('moves with the arrow keys, Home and End, and picks with Return', () => {
    const onPick = vi.fn();
    wrap(<MemoryScopePicker {...picker({ onPick })} />);
    const box = screen.getByRole('combobox', { name: 'Search projects' });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(OPTIONS.map((o) => o.name));
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0]?.id);

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    fireEvent.keyDown(box, { key: 'End' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[2]?.id);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it('names the chosen one on its button and marks it in the list', () => {
    wrap(<MemoryScopePicker {...picker({ value: OPTIONS[1] ?? null })} />);
    expect(document.querySelector('[data-slot=memory-scope-picker]')?.textContent).toBe('Trip to Goa reel');
    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.textContent)).toEqual(['Trip to Goa reel']);
  });

  it('passes each key typed in the box on, and Return with nothing listed picks nothing', () => {
    const onQueryChange = vi.fn();
    const onPick = vi.fn();
    wrap(<MemoryScopePicker {...picker({ options: [], query: 'zebra', onQueryChange, onPick })} />);
    const box = screen.getByRole('combobox', { name: 'Search projects' });
    fireEvent.change(box, { target: { value: 'zebras' } });
    expect(onQueryChange).toHaveBeenCalledWith('zebras');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('No project matches “zebra”.');
  });

  it('says so when there are none yet, and shows bones while they load', () => {
    const { rerender } = wrap(<MemoryScopePicker {...picker({ kind: 'template', options: [] })} />);
    expect(screen.getByRole('status').textContent).toBe(
      'There are no templates yet. Save one from a video first.',
    );
    rerender(
      <I18nProvider i18n={i18n}>
        <MemoryScopePicker {...picker({ options: null })} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading');
    expect(
      document.querySelector('[data-slot=memory-scope-popover] [data-slot=skeleton-lines]'),
    ).not.toBeNull();
  });

  it('names the cause when the list fails to load, with Try again', () => {
    const onRetry = vi.fn();
    wrap(<MemoryScopePicker {...picker({ options: null, error: timeout, onRetry })} />);
    expect(screen.getByRole('alert').textContent).toContain('This took too long and was stopped.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
