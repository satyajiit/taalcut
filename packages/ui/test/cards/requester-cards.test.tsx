// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Round P3-3: an external agent's consent and project-cap cards say who is asking and open Settings › External
// agents at that session, as its approvals do; the built-in agent's cards stay as they were.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BUDGET_CAP_FIXTURES, CONSENT_EXTERNAL_FIXTURE } from '../../src/cards/fixtures-flow';
import { CARD_FIXTURES, CardActionsProvider, CardView, type CardActions } from '../../src/index';

const answered = { ok: true as const, value: 'answered' as const };

const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );
const budgetCap = (name: string): CardOf<'budgetCap'> => {
  const card = BUDGET_CAP_FIXTURES[name];
  if (!card) throw new Error(`no budgetCap fixture ${name}`);
  return card;
};
const consent = (name: string): CardOf<'consent'> => {
  const card = CARD_FIXTURES.consent[name];
  if (!card) throw new Error(`no consent fixture ${name}`);
  return card;
};
const requesterLine = (container: HTMLElement) => container.querySelector('[data-slot="approval-requester"]');

describe.each([
  ['consent', CONSENT_EXTERNAL_FIXTURE],
  ['budgetCap', budgetCap('external')],
] as const)('%s card from an external agent', (_type, card) => {
  it('says who is asking above the rest, the name as written and not translated', () => {
    const { container } = wrap(<CardView card={card} />, {
      decide: vi.fn().mockResolvedValue(answered),
      dispatch: vi.fn(),
    });
    const line = requesterLine(container);
    expect(line?.textContent).toBe('Claude Code (an external agent) is asking');
    expect(line?.querySelector('[translate="no"]')?.textContent).toBe('Claude Code');
    expect(line?.getAttribute('translate')).toBeNull();
    // Right under the title, before what it asks about.
    expect(line?.previousElementSibling?.tagName).toBe('HEADER');
  });

  it('opens External agents at that session', async () => {
    const navigate = vi.fn();
    wrap(<CardView card={card} />, {
      decide: vi.fn().mockResolvedValue(answered),
      dispatch: vi.fn(),
      navigate,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change what Claude Code can do' }));
    });
    expect(navigate).toHaveBeenCalledWith({
      to: 'settings',
      section: 'external-agents',
      sessionId: card.requester?.sessionId,
    });
  });

  it('has no settings link where the window can’t navigate', () => {
    wrap(<CardView card={card} />, { decide: vi.fn().mockResolvedValue(answered) });
    expect(screen.queryByRole('button', { name: /Change what/ })).toBeNull();
  });
});

describe('the built-in agent’s consent and cap cards', () => {
  it.each([
    ['consent', consent('pending')],
    ['budgetCap', budgetCap('pending')],
  ] as const)('%s: no requester line and no settings link', (_type, card) => {
    const { container } = wrap(<CardView card={card} />, {
      decide: vi.fn().mockResolvedValue(answered),
      dispatch: vi.fn(),
      navigate: vi.fn(),
    });
    expect(requesterLine(container)).toBeNull();
    expect(screen.queryByRole('button', { name: /Change what/ })).toBeNull();
  });
});

describe('answering an external agent’s cards', () => {
  it('consent: Allow once answers its approval, as for the built-in agent', async () => {
    const decide = vi.fn().mockResolvedValue(answered);
    wrap(<CardView card={CONSENT_EXTERNAL_FIXTURE} />, { decide, navigate: vi.fn() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    });
    expect(decide).toHaveBeenCalledWith('ap-consent-mcp', 'approve', { remember: false });
  });

  it('budgetCap: Stop here answers its approval', async () => {
    const decide = vi.fn().mockResolvedValue(answered);
    wrap(<CardView card={budgetCap('external')} />, { decide, dispatch: vi.fn(), navigate: vi.fn() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop here' }));
    });
    expect(decide).toHaveBeenCalledWith('ap-cap-mcp', 'deny');
    expect(screen.getByText('Stopped at your budget')).toBeTruthy();
    // The settled card still says who asked and where to change what it may do.
    expect(screen.getByRole('button', { name: 'Change what Claude Code can do' })).toBeTruthy();
  });
});
