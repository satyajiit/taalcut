// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX4 kit, the motion grammar: the numbers (press, rise, a capped stagger), the class recipes and their
// reduced-motion resets, Collapse, NumberTicker, ArrivalList and Tick, and the dead primitives gone.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as kit from '../src';
import {
  ArrivalItem,
  ArrivalList,
  Collapse,
  NumberTicker,
  PRESS_CONTROL,
  PRESS_ROW,
  PRESS_SCALE,
  RISE,
  STAGGER,
  StaleContent,
  staggerDelay,
  Tick,
} from '../src';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);

describe('the grammar’s numbers', () => {
  it('presses a control by 2 % and a row by 1 %, and rises 8 px', () => {
    expect(PRESS_SCALE).toEqual({ control: 0.98, row: 0.99 });
    expect(RISE).toBe(8);
    expect(PRESS_CONTROL).toContain('active:scale-[0.98]');
    expect(PRESS_ROW).toContain('active:scale-[0.99]');
    for (const recipe of [PRESS_CONTROL, PRESS_ROW]) {
      expect(recipe).toContain('motion-reduce:active:scale-100');
      expect(recipe).toContain('duration-(--dur-micro)');
    }
  });

  it('staggers a list 40 ms an item and caps the whole cascade at 240 ms', () => {
    expect(STAGGER).toEqual({ step: 0.04, cap: 0.24 });
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBeCloseTo(0.12);
    expect(staggerDelay(6)).toBeCloseTo(0.24);
    expect(staggerDelay(40)).toBe(0.24);
    expect(staggerDelay(-1)).toBe(0);
  });
});

describe('Collapse', () => {
  it('keeps its content mounted but inert and hidden while closed', () => {
    const { rerender } = render(
      <Collapse open={false} id="more">
        <button>Inside</button>
      </Collapse>,
    );
    const region = document.getElementById('more')!;
    expect(region.dataset.state).toBe('closed');
    expect(region.hasAttribute('inert')).toBe(true);
    expect(region.getAttribute('aria-hidden')).toBe('true');
    expect(region.className).toContain('grid-rows-[0fr]');
    rerender(
      <Collapse open id="more">
        <button>Inside</button>
      </Collapse>,
    );
    expect(region.hasAttribute('inert')).toBe(false);
    expect(region.className).toContain('grid-rows-[1fr]');
    expect(region.className).toContain('transition-[grid-template-rows,opacity]');
  });
});

describe('NumberTicker', () => {
  it('shows the first number at once and ticks to a new one; screen readers get the final number', async () => {
    const { rerender } = render(<NumberTicker value={4} />, { wrapper });
    const ticker = document.querySelector('[data-slot=number-ticker]')!;
    expect(ticker.querySelector('[aria-hidden]')?.textContent).toBe('4');
    rerender(<NumberTicker value={12} />);
    expect(screen.getByText('12', { selector: '.sr-only' })).toBeTruthy();
    await waitFor(() => expect(ticker.querySelector('[aria-hidden]')?.textContent).toBe('12'), {
      timeout: 2000,
    });
  });
});

describe('ArrivalList', () => {
  it('cascades its items in, or shows them plainly when they were already there', () => {
    const { rerender } = render(
      <ArrivalList>
        <ArrivalItem index={0}>One</ArrivalItem>
        <ArrivalItem index={1}>Two</ArrivalItem>
      </ArrivalList>,
    );
    expect(document.querySelectorAll('[data-slot=arrival-item]')).toHaveLength(2);
    rerender(
      <ArrivalList animate={false}>
        <ArrivalItem index={0}>One</ArrivalItem>
      </ArrivalList>,
    );
    expect(document.querySelectorAll('[data-slot=arrival-item]')).toHaveLength(0);
    expect(screen.getByText('One').tagName).toBe('LI');
  });
});

describe('Tick', () => {
  it('draws in from @starting-style, or is simply there', () => {
    const { rerender } = render(<Tick />);
    const path = () => document.querySelector('[data-slot=tick] path')!;
    expect(path().getAttribute('class')).toContain('starting:[stroke-dashoffset:1]');
    rerender(<Tick draw={false} />);
    expect(path().getAttribute('class')).not.toContain('starting:');
  });
});

describe('dead primitives', () => {
  it('are gone: no cursor effect, pulse or no-op caret', () => {
    const names = Object.keys(kit);
    for (const dead of ['MagneticHover', 'PulseAura', 'StreamingCaret']) expect(names).not.toContain(dead);
    expect(names).toContain('StaggerGroup');
  });
});

describe('StaleContent', () => {
  it('dims the caller’s own element with asChild: its classes and role stay, no extra box', () => {
    render(
      <StaleContent stale asChild>
        <table className="w-full" aria-label="Spend by day">
          <tbody>
            <tr>
              <td>1</td>
            </tr>
          </tbody>
        </table>
      </StaleContent>,
    );
    const table = screen.getByRole('table', { name: 'Spend by day' });
    expect(table.dataset.slot).toBe('stale-content');
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(table.className).toContain('w-full');
    expect(table.className).toContain('opacity-55');
    expect(table.className).toContain('delay-150');
  });

  it('is busy but not dimmed while the same inputs are read again', () => {
    const { container } = render(
      <StaleContent stale={false} busy>
        <p>12</p>
      </StaleContent>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.className).not.toContain('opacity-55');
  });
});
