// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// G8's rateLimit card: every fixture renders as its status says (a line, or a decision card while it waits), the
// three choices answer the approval with the right `rateLimit` answer, Add credit opens the billing page, and the
// countdown says how long is left in each app language, once a minute, with one announcement at the last minute.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Card, CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardActionsProvider, CardView, type CardActions } from '../../src/index';

const answered = { ok: true as const, value: 'answered' as const };

const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );
const fixture = (name: string): CardOf<'rateLimit'> => {
  const card = CARD_FIXTURES.rateLimit[name];
  if (!card) throw new Error(`no rateLimit fixture ${name}`);
  return card;
};
const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};
const shortTime = (at: number, locale = 'en') =>
  new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(at);

afterEach(() => {
  vi.useRealTimers();
  i18n.activate('en');
});

describe('rateLimit card', () => {
  it.each(Object.entries(CARD_FIXTURES.rateLimit))('renders %s as its status says', (_, card) => {
    const { container } = wrap(<CardView card={card as Card} />, {
      decide: vi.fn().mockResolvedValue(answered),
      navigate: vi.fn(),
    });
    const root = container.querySelector('[data-card-type="rateLimit"]');
    expect(root?.getAttribute('data-status')).toBe(card.status);
    expect(root?.textContent?.trim().length).toBeGreaterThan(0);
    // Only a waiting card is a card (a frame with a title); the others are one line.
    expect(root?.tagName).toBe(card.status === 'waiting' ? 'ARTICLE' : 'DIV');
  });

  it('carries on at the reset time, or stops, as an answer to the approval', async () => {
    const decide = vi.fn().mockResolvedValue(answered);
    const card = fixture('waitingRate');
    wrap(<CardView card={card} />, { decide });
    expect(screen.getByRole('heading', { name: 'ChatGPT is busy' })).toBeTruthy();
    await press(`Carry on at ${shortTime(card.resetsAt ?? 0)}`);
    expect(decide).toHaveBeenLastCalledWith(card.approvalId, 'approve', {
      answer: { kind: 'rateLimit', choice: 'wait' },
    });
    await press('Stop');
    expect(decide).toHaveBeenLastCalledWith(card.approvalId, 'deny', {
      answer: { kind: 'rateLimit', choice: 'stop' },
    });
  });

  it('switches to a model from the menu, this Mac said as free', async () => {
    const decide = vi.fn().mockResolvedValue(answered);
    const card = fixture('waitingSixModels');
    wrap(<CardView card={card} />, { decide });
    const trigger = screen.getByRole('button', { name: 'Use another model' });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(6);
    expect(within(menu).getByText('On this Mac, free')).toBeTruthy();
    expect(within(menu).getByText('Anthropic · about $0.02')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(menu).getByText('claude-sonnet-5'));
    });
    expect(decide).toHaveBeenCalledWith(card.approvalId, 'approve', {
      answer: {
        kind: 'rateLimit',
        choice: 'switch',
        model: { provider: 'anthropic', model: 'claude-sonnet-5' },
      },
    });
  });

  it('offers Add credit for a key out of credit, and no menu without other models', async () => {
    const decide = vi.fn().mockResolvedValue(answered);
    const openExternal = vi.fn();
    const card = fixture('waitingQuota');
    wrap(<CardView card={card} />, { decide, openExternal });
    expect(screen.getByRole('heading', { name: 'Your OpenAI key is out of credit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Carry on/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use another model' })).toBeNull();
    await press('Add credit');
    expect(openExternal).toHaveBeenCalledWith(card.billingUrl);
    expect(decide).not.toHaveBeenCalled();
  });

  it('has no Add credit without a billing page, and says when the reset time is unknown', () => {
    const { unmount } = wrap(<CardView card={fixture('waitingQuotaNoBilling')} />, {
      decide: vi.fn().mockResolvedValue(answered),
      openExternal: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: 'Add credit' })).toBeNull();
    expect(screen.getByText('Add credit to the key, or use another model.')).toBeTruthy();
    unmount();
    wrap(<CardView card={fixture('waitingRateNoReset')} />, { decide: vi.fn().mockResolvedValue(answered) });
    expect(screen.getByText('In a few minutes. Taalcut keeps trying.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wait and carry on' })).toBeTruthy();
  });

  it('under Local only offers only this Mac', async () => {
    wrap(<CardView card={fixture('localOnly')} />, { decide: vi.fn().mockResolvedValue(answered) });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Use another model' }), { key: 'Enter' });
    });
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('On this Mac, free');
  });

  it('undoes a switch for this video, or keeps the model it switched to', async () => {
    const decide = vi.fn().mockResolvedValue(answered);
    const card = fixture('switched');
    wrap(<CardView card={card} />, { decide });
    expect(screen.getByText(/ChatGPT is busy, so this step used/).textContent).toContain(
      'claude-sonnet-5 (Anthropic). About $0.02 more.',
    );
    expect(screen.getByText('claude-sonnet-5').getAttribute('translate')).toBe('no');
    await press('Undo for this video');
    expect(decide).toHaveBeenLastCalledWith(card.approvalId, 'approve', {
      answer: { kind: 'rateLimit', choice: 'wait' },
    });
    await press('Keep using it');
    expect(decide).toHaveBeenLastCalledWith(card.approvalId, 'approve', {
      answer: {
        kind: 'rateLimit',
        choice: 'switch',
        model: { provider: 'anthropic', model: 'claude-sonnet-5' },
      },
    });
  });

  it('says a switch to this Mac, the resume and the stop in one line', async () => {
    const navigate = vi.fn();
    const { unmount } = wrap(<CardView card={fixture('switchedLocal')} />);
    expect(screen.getByText(/so this step used/).textContent).toContain('qwen3.5-4b on this Mac.');
    unmount();
    const resumed = fixture('resumed');
    const second = wrap(<CardView card={resumed} />);
    expect(screen.getByText(`Carried on at ${shortTime(resumed.resetsAt ?? 0)}.`)).toBeTruthy();
    second.unmount();
    wrap(<CardView card={fixture('stopped')} />, { navigate });
    expect(screen.getByText('Stopped: ChatGPT’s limit.')).toBeTruthy();
    await press('Usage');
    expect(navigate).toHaveBeenCalledWith({ to: 'settings', section: 'usage' });
  });

  it('hides every answer without a way to send it', () => {
    wrap(<CardView card={fixture('waitingRate')} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('rateLimit countdown', () => {
  const NOW = Date.UTC(2026, 9, 14, 9, 0, 0);
  const capitalised = (text: string, locale: string) =>
    text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  const inMinutes = (minutes: number, locale: string) =>
    capitalised(new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(minutes, 'minute'), locale);
  const countdown = (container: HTMLElement) =>
    container.querySelector('[data-slot="rate-limit-countdown"]')?.textContent ?? '';

  it.each(['en', 'hi', 'es', 'pt-BR'])('counts down by the minute in %s', async (locale) => {
    vi.useFakeTimers({ now: NOW });
    i18n.loadAndActivate({ locale, messages: {} });
    const card = { ...fixture('waitingRate'), resetsAt: NOW + 12 * 60_000 };
    const { container } = wrap(<CardView card={card} />, { decide: vi.fn().mockResolvedValue(answered) });
    expect(countdown(container)).toBe(inMinutes(12, locale));
    expect(container.querySelector('[data-slot="rate-limit-countdown"]')?.getAttribute('aria-live')).toBe(
      'off',
    );
    // Not each second: half a minute later it still says 12.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(countdown(container)).toBe(inMinutes(12, locale));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(countdown(container)).toBe(inMinutes(11, locale));
  });

  it('announces the last minute once, then says any moment', async () => {
    vi.useFakeTimers({ now: NOW });
    const card = { ...fixture('waitingRate'), resetsAt: NOW + 2 * 60_000 };
    const { container } = wrap(<CardView card={card} />, { decide: vi.fn().mockResolvedValue(answered) });
    const status = () => screen.getByRole('status');
    expect(status().textContent).toBe('');
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(countdown(container)).toBe('In 1 minute');
    expect(status().textContent).toBe('ChatGPT resets in about a minute.');
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(countdown(container)).toBe('Any moment now.');
    expect(status().textContent).toBe('ChatGPT resets in about a minute.');
  });
});
