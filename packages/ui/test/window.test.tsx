// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  AvartanMark,
  createFormatters,
  WindowBar,
  WindowBarPreview,
  WindowControls,
  WindowControlsPreview,
  WindowTitle,
} from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
const group = () => screen.getByRole('group', { name: 'Window controls' });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

describe('window controls', () => {
  it('are three named buttons, out of the tab order, in a "Window controls" group', () => {
    wrap(<WindowControls onAction={() => {}} />);
    const buttons = within(group()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Close window',
      'Minimize window',
      'Enter full screen',
    ]);
    for (const b of buttons) expect(b.tabIndex).toBe(-1);
  });

  it('go full screen by default and zoom with Option held, name included', () => {
    const onAction = vi.fn();
    wrap(<WindowControls onAction={onAction} />);
    fireEvent.click(button('Enter full screen'));
    expect(onAction).toHaveBeenLastCalledWith('fullScreen', { allWindows: false });
    act(() => void fireEvent.keyDown(window, { key: 'Alt', altKey: true }));
    fireEvent.click(button('Zoom window'), { altKey: true });
    expect(onAction).toHaveBeenLastCalledWith('zoom', { allWindows: false });
    act(() => void fireEvent.keyUp(window, { key: 'Alt', altKey: false }));
    expect(button('Enter full screen')).toBeTruthy();
  });

  it('Option-click closes or minimises every window', () => {
    const onAction = vi.fn();
    wrap(<WindowControls onAction={onAction} />);
    fireEvent.click(button('Minimize window'), { altKey: true });
    expect(onAction).toHaveBeenLastCalledWith('minimize', { allWindows: true });
    fireEvent.click(button('Close window'));
    expect(onAction).toHaveBeenLastCalledWith('close', { allWindows: false });
  });

  it('in full screen, the third control leaves it, Option or not', () => {
    const onAction = vi.fn();
    wrap(<WindowControls fullScreen onAction={onAction} />);
    fireEvent.click(button('Exit full screen'), { altKey: true });
    expect(onAction).toHaveBeenLastCalledWith('fullScreen', { allWindows: false });
  });

  it('are drawn but inert without a window behind the page', () => {
    wrap(<WindowControls />);
    for (const b of within(group()).getAllByRole<HTMLButtonElement>('button')) expect(b.disabled).toBe(true);
  });

  it('do not wait on the window: a call that did not land leaves them as they are', async () => {
    // The caller reports its own failures (the renderer's window client logs them).
    const onAction = vi.fn(() => Promise.resolve(false));
    wrap(<WindowControls onAction={onAction} />);
    const minimize = button('Minimize window');
    await act(async () => void fireEvent.click(minimize));
    expect(onAction).toHaveBeenCalledWith('minimize', { allWindows: false });
    expect(minimize.disabled).toBe(false);
    expect(minimize.hasAttribute('aria-busy')).toBe(false);
  });

  it('draw the macOS glyphs: ×, −, and the full-screen arrows that turn into + with Option', () => {
    const { container } = wrap(<WindowControls onAction={() => {}} />);
    const glyph = (name: string) => button(name).querySelector('svg path');
    expect(glyph('Close window')?.getAttribute('stroke')).toBe('currentColor');
    expect(glyph('Enter full screen')?.getAttribute('fill')).toBe('currentColor');
    act(() => void fireEvent.keyDown(window, { key: 'Alt', altKey: true }));
    expect(glyph('Zoom window')?.getAttribute('fill')).toBe('none');
    expect(container.querySelectorAll('[data-slot=window-control] svg')).toHaveLength(3);
  });

  it('mark unsaved changes with a dot in the close control', () => {
    const { container, rerender } = wrap(<WindowControls edited onAction={() => {}} />);
    expect(container.querySelector('[data-slot=window-edited-dot]')).not.toBeNull();
    rerender(
      <I18nProvider i18n={i18n}>
        <WindowControls onAction={() => {}} />
      </I18nProvider>,
    );
    expect(container.querySelector('[data-slot=window-edited-dot]')).toBeNull();
  });
});

describe('window bar', () => {
  it('is a drag region with the controls, the mark and the title; clickable parts are not', () => {
    const { container } = wrap(
      <WindowBar
        controls={<WindowControls onAction={() => {}} />}
        title={<WindowTitle title="Library" />}
        actions={<button type="button">Import</button>}
      />,
    );
    expect(container.querySelector('[data-slot=window-bar]')?.classList.contains('app-drag')).toBe(true);
    expect(group().classList.contains('app-no-drag')).toBe(true);
    const actions = container.querySelector('[data-slot=window-bar-actions]');
    expect(actions?.classList.contains('app-no-drag')).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
    expect(container.querySelector('[data-slot=avartan-mark]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('in full screen keeps the title but drops the controls and dragging', () => {
    const { container } = wrap(
      <WindowBar fullScreen controls={<WindowControls onAction={() => {}} />} title="Library" />,
    );
    expect(screen.queryByRole('group', { name: 'Window controls' })).toBeNull();
    expect(container.querySelector('[data-slot=window-bar]')?.classList.contains('app-drag')).toBe(false);
    expect(screen.getByText('Library')).toBeTruthy();
  });

  it('passes a double-click on its empty part on, never one on a control', () => {
    const onDoubleClick = vi.fn();
    const { container } = wrap(
      <WindowBar controls={<WindowControls onAction={() => {}} />} onDoubleClick={onDoubleClick} />,
    );
    fireEvent.doubleClick(button('Close window'));
    expect(onDoubleClick).not.toHaveBeenCalled();
    fireEvent.doubleClick(container.querySelector('[data-slot=window-bar-main]')!);
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('names what is open after the page, as a heading or a plain line', () => {
    const { rerender } = wrap(<WindowTitle title="Agent" detail="Trip to Goa reel" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AgentTrip to Goa reel');
    rerender(<WindowTitle as="p" title="Set up Taalcut" />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('the mark and the previews', () => {
  it('the mark is hidden beside its words and named when alone', () => {
    const { container, rerender } = wrap(<AvartanMark />);
    expect(container.querySelector('[data-slot=avartan-mark]')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<AvartanMark label="Taalcut" />);
    expect(screen.getByRole('img', { name: 'Taalcut' })).toBeTruthy();
  });

  it('the previews show every state', () => {
    wrap(
      <>
        <WindowControlsPreview />
        <WindowBarPreview />
      </>,
    );
    const states = ['Default', 'Hover', 'Pressed', 'Inactive', 'Disabled', 'Focus (assistive tech)'];
    for (const name of states) expect(screen.getByRole('group', { name })).toBeTruthy();
    for (const name of ['Loading', 'Error', 'Success'])
      expect(screen.queryByRole('group', { name })).toBeNull();
    expect(
      screen.getByRole('group', { name: 'Inactive' }).closest('[data-window-active=false]'),
    ).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Disabled' }).querySelector('button:disabled')).not.toBeNull();
  });
});

describe('relative days (the chat list)', () => {
  it('says the time today, Yesterday, the weekday this week, then the date', () => {
    const format = createFormatters('en');
    const now = new Date(2026, 9, 13, 15, 0).getTime();
    const at = (day: number, hour = 9, year = 2026) => new Date(year, 9, day, hour, 5).getTime();
    expect(format.relativeDay(at(13), now)).toMatch(/^9:05/);
    expect(format.relativeDay(at(12, 23), now)).toBe('Yesterday');
    expect(format.relativeDay(at(9), now)).toBe('Friday');
    expect(format.relativeDay(at(1), now)).toBe('Oct 1');
    expect(format.relativeDay(at(1, 9, 2025), now)).toBe('Oct 1, 2025');
  });
});
