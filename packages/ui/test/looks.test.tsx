// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { StyleId } from '@taalcut/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LOOK_FIXTURES, STYLE_BATCH_FIXTURES, WARM_FILM } from '../src/cards/fixtures-looks';
import { CARD_FIXTURES, CardView, LookPicker, StyleChip } from '../src/index';
import { wrap } from './make-fixture';

const open = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });

function Picker({ onChange }: { onChange: (styleId: StyleId | null) => void }) {
  const [value, setValue] = useState<StyleId | null>(null);
  return (
    <I18nProvider i18n={i18n}>
      <LookPicker
        styles={LOOK_FIXTURES}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        onManage={() => onChange(null)}
      />
    </I18nProvider>
  );
}

describe('StyleChip', () => {
  it('names the kit as written, untranslated, with its swatch and Default', () => {
    render(
      <I18nProvider i18n={i18n}>
        <StyleChip {...LOOK_FIXTURES[0]!} logoUrl={null} />
      </I18nProvider>,
    );
    expect(screen.getByText('Chai & Co.').hasAttribute('data-user-content')).toBe(true);
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the swatch when the logo won’t load, never a broken image', () => {
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <StyleChip {...LOOK_FIXTURES[1]!} logoUrl="app://media/styles/x.png" />
      </I18nProvider>,
    );
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('M');
  });
});

describe('LookPicker', () => {
  it('sets a look and clears it again, by pointer and by keyboard', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Look: None' });
    open(button);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Brand kits')).toBeTruthy();
    expect(within(menu).getByText('Looks')).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Warm film/ }));
    expect(onChange).toHaveBeenLastCalledWith(WARM_FILM);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Look: Warm film' })).toBeTruthy());
    // Clear it with the keyboard: open, Home (None), Enter.
    const again = screen.getByRole('button', { name: 'Look: Warm film' });
    again.focus();
    fireEvent.keyDown(again, { key: 'ArrowDown' });
    const none = await screen.findByRole('menuitemradio', { name: 'None' });
    fireEvent.keyDown(none, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Look: None' })).toBeTruthy());
  });

  it('picking the look in use changes nothing; Manage brand kits… calls onManage', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    open(screen.getByRole('button', { name: 'Look: None' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }));
    expect(onChange).not.toHaveBeenCalled();
    open(screen.getByRole('button', { name: 'Look: None' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage brand kits…' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('is busy while the list loads and says when the look in use is gone', () => {
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <LookPicker styles={undefined} value={null} onChange={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
    rerender(
      <I18nProvider i18n={i18n}>
        <LookPicker
          styles={LOOK_FIXTURES}
          value={'01K7C5M6Q8Z00000000000000X' as StyleId}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Look: Missing look' })).toBeTruthy();
  });
});

describe('styleBatch card', () => {
  it('is the registry’s fixture set', () => {
    expect(CARD_FIXTURES.styleBatch).toMatchObject(STYLE_BATCH_FIXTURES);
  });

  it('says what it applied and why it skipped, in words', () => {
    wrap(<CardView card={STYLE_BATCH_FIXTURES.preset!} />);
    expect(screen.getByRole('heading').textContent).toBe('Applied Bold captions to 3 videos');
    expect(screen.getByText('2 videos have no captions, so they kept their look')).toBeTruthy();
    expect(screen.getAllByText('No captions')).toHaveLength(2);
    wrap(<CardView card={STYLE_BATCH_FIXTURES.kit!} />);
    expect(screen.getByText('1 video was changed since; its look stays')).toBeTruthy();
    wrap(<CardView card={STYLE_BATCH_FIXTURES.none!} />);
    expect(screen.getByRole('heading', { name: 'Karaoke captions fits none of these videos' })).toBeTruthy();
  });

  it('keeps the look’s name untranslated and folds a long list', () => {
    wrap(<CardView card={STYLE_BATCH_FIXTURES.kit!} />);
    expect(screen.getByText('Chai & Co.').hasAttribute('data-user-content')).toBe(true);
    const list = screen.getByRole('list', { name: 'Videos' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 videos' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });

  it('settles cleanly without inline Undo all buttons on the card', () => {
    const card = STYLE_BATCH_FIXTURES.look!;
    wrap(<CardView card={card} />, { undo: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Undo all' })).toBeNull();
  });

  it('opens a video in the editor', () => {
    const navigate = vi.fn();
    wrap(<CardView card={STYLE_BATCH_FIXTURES.preset!} />, { navigate });
    fireEvent.click(screen.getAllByRole('button', { name: /^Open/ })[0]!);
    // The skipped come first.
    expect(navigate).toHaveBeenCalledWith({
      to: 'timeline',
      projectId: STYLE_BATCH_FIXTURES.preset!.skipped[0]!.projectId,
      timelineId: STYLE_BATCH_FIXTURES.preset!.skipped[0]!.timelineId,
    });
  });
});
