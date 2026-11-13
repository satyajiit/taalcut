// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-AGT: what a step's cost and a project's budget say. Never the whole budget "left" as news: nothing until
// something is spent (unless the budget is the subject), then what is spent, and what is left once that is near.
// A ChatGPT plan has no money: its line says "on your plan". A run's costs sit in its details, closed.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CostEstimateCardV2, Money } from '@taalcut/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CapMeter, CARD_FIXTURES, CostEstimateV2Card, HostPlatformProvider, RunBlock } from '../../src/index';

const usd = (micros: number): Money => ({ currency: 'USD', micros });
const CAP = usd(2_000_000);

const wrap = (node: ReactNode, platform: 'mac' | 'linux' = 'mac') =>
  render(
    <I18nProvider i18n={i18n}>
      <HostPlatformProvider platform={platform}>{node}</HostPlatformProvider>
    </I18nProvider>,
  );

const meterText = () => document.querySelector('[data-slot=cap-meter] p')?.textContent;

const STEP = CARD_FIXTURES.costEstimate!['goingAhead'] as CostEstimateCardV2;

/** A step on the person's ChatGPT plan: priced at US$0 under the plan's id (models' price lookup). */
const ON_PLAN: CostEstimateCardV2 = {
  ...STEP,
  id: 'cost-plan',
  estimate: { money: usd(60_000), tokens: 61_000 },
  lines: [
    {
      module: 'agent',
      provider: 'openai-codex',
      model: 'gpt-5.4',
      local: false,
      money: usd(0),
      tokens: 9_000,
    },
    {
      module: 'vision',
      provider: 'google',
      model: 'gemini-2.5-flash',
      local: false,
      money: usd(60_000),
      tokens: 52_000,
    },
  ],
  cap: { cap: CAP, spent: usd(0) },
};

describe('the project budget meter', () => {
  it('says nothing with nothing spent: a full budget isn’t news', () => {
    wrap(<CapMeter cap={CAP} spent={usd(0)} next={usd(140_000)} />);
    expect(document.querySelector('[data-slot=cap-meter]')).toBeNull();
  });

  it('says what is spent once something is', () => {
    wrap(<CapMeter cap={CAP} spent={usd(380_000)} next={usd(140_000)} />);
    expect(meterText()).toBe('$0.38 spent of this project’s $2.00 budget.');
    expect(meterText()).not.toMatch(/left/);
  });

  it('adds what is left near the cap', () => {
    wrap(<CapMeter cap={CAP} spent={usd(1_700_000)} />);
    expect(meterText()).toBe('$1.70 spent of this project’s $2.00 budget: $0.30 left.');
    expect(document.querySelector('[data-slot=cap-meter]')?.getAttribute('data-state')).toBe('near');
  });

  it('warns when the next step would go over', () => {
    wrap(<CapMeter cap={CAP} spent={usd(1_900_000)} next={usd(140_000)} />);
    expect(meterText()).toBe('$1.90 spent of this project’s $2.00 budget: the next step would go over.');
    expect(document.querySelector('[data-slot=cap-meter]')?.hasAttribute('data-over')).toBe(true);
  });

  it('where the budget is the subject, says nothing is spent yet, never “$2.00 left of $2.00”', () => {
    wrap(<CapMeter always cap={CAP} spent={usd(0)} />);
    expect(meterText()).toBe('Nothing spent yet of this project’s $2.00 budget.');
    expect(document.body.textContent).not.toMatch(/left/);
  });
});

describe('a step’s cost', () => {
  it('with an API key and some spent: the money by model, and what is spent of the budget', () => {
    wrap(<CostEstimateV2Card card={STEP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cost breakdown' }));
    const lines = screen.getByRole('list', { name: 'By model' });
    expect(lines.textContent).toContain('$0.12');
    expect(meterText()).toBe('$0.42 spent of this project’s $2.00 budget.');
  });

  it('with an API key and nothing spent: no budget line at all', () => {
    wrap(<CostEstimateV2Card card={{ ...STEP, cap: { cap: CAP, spent: usd(0) } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cost breakdown' }));
    expect(document.querySelector('[data-slot=cap-meter]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/left of|left\./);
  });

  it('on the ChatGPT plan: “on your plan”, no money for it', () => {
    wrap(<CostEstimateV2Card card={ON_PLAN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cost breakdown' }));
    const plan = within(screen.getByRole('list', { name: 'By model' })).getAllByRole('listitem')[0]!;
    expect(plan.textContent).toContain('ChatGPT');
    expect(plan.textContent).toContain('on your plan');
    expect(plan.textContent).not.toContain('$');
    expect(document.querySelector('[data-slot=cap-meter]')).toBeNull();
  });

  it('names an on-device model’s place as this computer off a Mac', () => {
    wrap(<CostEstimateV2Card card={STEP} />, 'linux');
    fireEvent.click(screen.getByRole('button', { name: 'Cost breakdown' }));
    const lines = screen.getByRole('list', { name: 'By model' });
    expect(lines.textContent).toContain('This computer');
    expect(lines.textContent).not.toMatch(/\bMac\b/);
  });
});

describe('a run’s costs', () => {
  it('keeps settled costs inside the single activity disclosure', () => {
    const plan = CARD_FIXTURES.plan!['finished']!;
    wrap(<RunBlock plan={plan} costs={[{ ...STEP, status: 'settled' }]} />);
    const toggle = document.querySelector<HTMLElement>('[data-slot=run-activity-toggle]')!;
    const region = document.querySelector<HTMLElement>('[data-slot=run-activity]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(region.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.textContent).not.toMatch(/\$/);
    fireEvent.click(toggle);
    expect(within(region).getByRole('list', { name: 'By model' }).textContent).toContain('$0.12');
    expect(region.querySelectorAll('details, button[aria-expanded]')).toHaveLength(0);
  });

  it('keeps an active cost visible without opening activity', () => {
    wrap(<RunBlock costs={[STEP]} />);
    const cost = document.querySelector('[data-card-type=costEstimate]')!;
    expect(cost).not.toBeNull();
    expect(cost.closest('[data-slot=run-activity]')).toBeNull();
    expect(cost.textContent).toContain('$0.12');
  });
});
