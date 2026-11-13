// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  SelectionChip,
  SelectionTray,
  createTimecode,
  framesToMs,
  msToFrames,
  type SelectionChipView,
} from '../src/index';

const RATE = { num: 30, den: 1 } as const;
const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const clip = (index: number, frames = 120): SelectionChipView => ({
  kind: 'clip',
  key: `clip-${index}`,
  index,
  at: { frames, rate: RATE },
});
const many = (count: number) => Array.from({ length: count }, (_, i) => clip(i + 1, i * 30));
const removers = () => screen.getAllByRole('button', { name: /^Remove / });

function Tray({ start, max }: { start: readonly SelectionChipView[]; max?: number }) {
  const [chips, setChips] = useState(start);
  return (
    <SelectionTray
      chips={chips}
      {...(max === undefined ? {} : { max })}
      onRemove={(key) => setChips((all) => all.filter((chip) => chip.key !== key))}
    />
  );
}

describe('timecodes', () => {
  it('reads frames as a clock and a length', () => {
    const time = createTimecode('en');
    expect(time.clock(120, RATE)).toBe('00:04');
    expect(time.clock(123.6, RATE, { fraction: true })).toBe('00:04.12');
    expect(time.clock(30 * 3723, RATE)).toBe('1:02:03');
    expect(time.length(45, RATE)).toBe('1.5s');
  });

  it('converts frames and milliseconds at a rational rate', () => {
    const ntsc = { num: 30_000, den: 1001 };
    expect(framesToMs(30, RATE)).toBe(1000);
    expect(msToFrames(1001, ntsc)).toBe(30);
  });
});

describe('selection chip', () => {
  it('labels a clip, a range and a slot with Intl times and numbers', () => {
    wrap(
      <>
        <SelectionChip chip={clip(3)} />
        <SelectionChip
          chip={{
            kind: 'range',
            key: 'r',
            start: { frames: 30, rate: RATE },
            end: { frames: 75, rate: RATE },
          }}
        />
        <SelectionChip chip={{ kind: 'slot', key: 's', index: 2, name: 'Opening hook' }} />
      </>,
    );
    expect(screen.getByText('Clip 3 · 00:04')).toBeTruthy();
    expect(screen.getByText('00:01–00:02')).toBeTruthy();
    expect(screen.getByText('Slot 2')).toBeTruthy();
    const name = screen.getByText('Opening hook');
    expect(name.getAttribute('translate')).toBe('no');
  });

  it('renders a library asset chip with its filename protected from translation', () => {
    const onRemove = vi.fn();
    const { container } = wrap(
      <SelectionChip chip={{ kind: 'asset', key: 'asset:1', name: 'IMG_0412.MOV' }} onRemove={onRemove} />,
    );
    const filename = screen.getByText('IMG_0412.MOV');
    expect(filename.getAttribute('translate')).toBe('no');
    expect(filename.hasAttribute('data-user-content')).toBe(true);
    expect(filename.className).toContain('truncate');
    expect(container.querySelector('[data-kind="asset"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove IMG_0412.MOV' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('removes with its × and opens from history', () => {
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    wrap(<SelectionChip chip={clip(3)} onRemove={onRemove} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Clip 3 · 00:04' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clip 3 · 00:04' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says when its thing was deleted, and opens nothing', () => {
    const onOpen = vi.fn();
    const { container } = wrap(<SelectionChip chip={clip(3)} gone onOpen={onOpen} />);
    expect(screen.getByText('This was deleted.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-gone]')).not.toBeNull();
  });
});

describe('selection tray', () => {
  it('shows six chips and folds the rest into +n', () => {
    wrap(<Tray start={many(9)} />);
    expect(removers()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }));
    expect(removers()).toHaveLength(9);
  });

  it('keeps seven without folding one away', () => {
    wrap(<Tray start={many(7)} />);
    expect(removers()).toHaveLength(7);
    expect(screen.queryByRole('button', { name: /more$/ })).toBeNull();
  });

  it('stops at fifty and says why', () => {
    wrap(<Tray start={many(53)} />);
    expect(screen.getByText('One message can point at 50 things at most.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 44 more' }));
    expect(removers()).toHaveLength(50);
  });

  it('has one tab stop that the arrows move, Home and End included', () => {
    wrap(<Tray start={many(4)} />);
    const buttons = removers();
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: 'End' });
    expect(document.activeElement).toBe(buttons[3]);
    fireEvent.keyDown(buttons[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    expect(removers().map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('removes the focused chip with Delete, says so, and keeps focus on the next one', async () => {
    wrap(<Tray start={many(3)} />);
    const [, second, third] = removers();
    second!.focus();
    fireEvent.keyDown(second!, { key: 'Delete' });
    expect(screen.getByRole('status').textContent).toBe('Removed Clip 2 · 00:01');
    await waitFor(() => expect(document.activeElement).toBe(third));
    await waitFor(() => expect(screen.queryByText('Clip 2 · 00:01')).toBeNull());
    const tray = screen.getByRole('group', { name: 'What this message points at' });
    expect(within(tray).getAllByRole('button')).toHaveLength(2);
    expect(third!.tabIndex).toBe(0);
  });

  it('moves focus back from the last chip as it goes', async () => {
    wrap(<Tray start={many(2)} />);
    const [first, last] = removers();
    last!.focus();
    fireEvent.keyDown(last!, { key: 'Backspace' });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('announces a chip as it arrives', () => {
    const { rerender } = wrap(<SelectionTray chips={many(1)} onRemove={vi.fn()} />);
    rerender(
      <I18nProvider i18n={i18n}>
        <SelectionTray chips={many(2)} onRemove={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe('Added Clip 2 · 00:01');
  });
});
