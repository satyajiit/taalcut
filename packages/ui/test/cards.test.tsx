// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Card } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_COMPONENTS,
  CARD_FIXTURES,
  CardActionsProvider,
  CardView,
  ChatMessage,
  Composer,
  ConversationList,
  Reasoning,
  UnsupportedCard,
  type CardActions,
} from '../src/index';

const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );

const allFixtures = Object.entries(CARD_FIXTURES).flatMap(([type, fixtures]) =>
  Object.entries(fixtures).map(([name, card]) => ({ label: `${type}/${name}`, card: card as Card })),
);

describe('card registry', () => {
  // The kit may not import core's runtime: the renderer's tests check these
  // keys against CARD_TYPES; here, components and fixtures match each other.
  it('has a component and at least one fixture for every card type', () => {
    expect(Object.keys(CARD_FIXTURES).sort()).toEqual(Object.keys(CARD_COMPONENTS).sort());
    for (const fixtures of Object.values(CARD_FIXTURES))
      expect(Object.keys(fixtures).length).toBeGreaterThan(0);
  });

  it.each(allFixtures)('renders $label', ({ card }) => {
    const { container } = wrap(<CardView card={card} />);
    const root = container.querySelector(`[data-card-type="${card.type}"]`);
    expect(root).not.toBeNull();
    expect(root?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('runs an error card fix through CardActions', () => {
    const runFix = vi.fn();
    wrap(<CardView card={CARD_FIXTURES.error.withFix!} />, { runFix });
    fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }));
    expect(runFix).toHaveBeenCalledWith({ command: 'sources.choose', labelKey: 'fix.chooseFolder' });
  });

  it('answers an approval through CardActions, and hides the buttons without a handler', () => {
    const decide = vi.fn(async () => ({ ok: true as const, value: 'answered' as const }));
    const approval = CARD_FIXTURES.approval.pending!;
    const { unmount } = wrap(<CardView card={approval} />);
    expect(screen.queryByRole('button', { name: 'Go ahead' })).toBeNull();
    unmount();
    wrap(<CardView card={approval} />, { decide });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(decide).toHaveBeenCalledWith('ap-1', 'deny');
  });

  it('reveals every plan step with its status in words through one activity disclosure', () => {
    wrap(<CardView card={CARD_FIXTURES.plan.running!} />);
    const toggle = screen.getByRole('button', { name: /^Activity/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    // The status mark says its status in words (role img, named), so colour is never the only signal.
    for (const [index, status] of ['Done', 'In progress', 'Not started'].entries()) {
      expect(within(steps[index]!).getByRole('img', { name: status })).toBeTruthy();
      expect(within(steps[index]!).getByText(CARD_FIXTURES.plan.running!.steps[index]!.text)).toBeTruthy();
    }
    expect(screen.getAllByRole('button')).toEqual([toggle]);
  });

  it('formats money, tokens and time with Intl', () => {
    wrap(<CardView card={CARD_FIXTURES.costEstimate.needsApproval!} />);
    // The money is the decision (UX round 1), and the step, tokens and time sit in view under it.
    expect(screen.getByRole('heading', { name: 'Spend about $0.042?' })).toBeTruthy();
    expect(screen.getByText('Look at a frame · 12,400 tokens · 9s')).toBeTruthy();
  });

  it("shows the agent's error as one line that names the thing, with its fix", async () => {
    const runFix = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true },
      })
      .mockResolvedValueOnce({ ok: true, value: undefined });
    const { container } = wrap(<CardView card={CARD_FIXTURES.error.withFix!} />, { runFix });
    expect(container.querySelector('[data-slot=error-card]')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('That folder is no longer here.');
    // A fix that fails says why in place of the first cause.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('This took too long');
    expect(runFix).toHaveBeenCalledTimes(1);
  });

  it('names the missing thing when the error carries its name, as written', () => {
    const fixture = CARD_FIXTURES.error.withFix!;
    const named = {
      ...fixture,
      error: { ...fixture.error, params: { entity: 'source', name: 'Diwali 2025' } },
    } as Card;
    wrap(<CardView card={named} />);
    expect(screen.getByRole('alert').textContent).toContain('The folder “Diwali 2025” is no longer here.');
  });

  it('confirms a fix that works quietly, in place of the error', async () => {
    const runFix = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    wrap(<CardView card={CARD_FIXTURES.error.withFix!} />, { runFix });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Choose another folder: done');
  });

  it('has a fallback for cards this version cannot show', () => {
    wrap(<UnsupportedCard />);
    expect(screen.getByText(/needs a newer version of Taalcut to show/)).toBeTruthy();
  });

  it('offers Try again to continue when a run stops at agent.turn_limit and chat is idle', () => {
    const followUp = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const turnLimitCard: Card = {
      type: 'error',
      id: 'run-error:01K7C5M6Q8R9S0T1V2W3X4Y5ZA',
      version: 1,
      error: {
        code: 'agent.turn_limit',
        messageKey: 'errors.agent.turn_limit',
        retryable: false,
        params: { limit: 25 },
      },
    };
    const { rerender } = wrap(<CardView card={turnLimitCard} />, { followUp, busy: false });
    expect(screen.getByRole('alert').textContent).toContain('Taalcut stopped after 25 steps');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(followUp).toHaveBeenCalledWith(
      '01K7C5M6Q8R9S0T1V2W3X4Y5ZA',
      'Continue from where you stopped.',
      [],
    );

    rerender(
      <I18nProvider i18n={i18n}>
        <CardActionsProvider value={{ followUp, busy: true }}>
          <CardView card={turnLimitCard} />
        </CardActionsProvider>
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('chat pieces', () => {
  it('marks agent and user messages with a word as well as colour', () => {
    wrap(
      <>
        <ChatMessage role="user" text="Add my Desktop/Trip folder" />
        <ChatMessage role="agent" text="Added it." streaming />
      </>,
    );
    const [user, agent] = screen.getAllByRole('article');
    expect(user?.dataset.role).toBe('user');
    expect(user?.textContent).toContain('You');
    expect(agent?.dataset.role).toBe('agent');
    expect(agent?.textContent).toContain('Taalcut');
    expect(agent?.getAttribute('aria-busy')).toBe('true');
  });

  it('sends with Enter and turns the send button into Stop while busy', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = wrap(<Composer busy={false} onSend={onSend} onStop={onStop} />);
    const box = screen.getByRole('textbox', { name: 'Message Taalcut' });
    fireEvent.change(box, { target: { value: 'Hello there' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Hello there');
    rerender(
      <I18nProvider i18n={i18n}>
        <Composer busy onSend={onSend} onStop={onStop} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('shows reasoning open while thinking', () => {
    const { container } = wrap(<Reasoning text="First the folder." working />);
    expect(container.querySelector('details')?.open).toBe(true);
    expect(screen.getByText('First the folder.')).toBeTruthy();
  });

  it('lists conversations newest first, marks the open one, and keeps long or multi-line titles single-line truncated', () => {
    const { container } = wrap(
      <ConversationList
        activeId="b"
        conversations={[
          { id: 'a', title: 'Older\nmulti-line   conversation title that is very long', updatedAt: 1 },
          { id: 'b', title: 'Newer', updatedAt: 2 },
        ]}
        renderLink={(conversation, props) => (
          <a href={`#${conversation.id}`} {...props}>
            {props.children}
          </a>
        )}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links[0]?.textContent).toContain('Newer');
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(links[1]?.getAttribute('aria-current')).toBeNull();
    expect(links[1]?.className).toContain('min-w-0');
    expect(links[1]?.className).toContain('overflow-hidden');
    const userSpans = container.querySelectorAll('[data-user-content]');
    expect(userSpans[1]?.textContent).toBe('Older multi-line conversation title that is very long');
    expect(userSpans[1]?.className).toContain('whitespace-nowrap');
    expect(userSpans[1]?.className).not.toContain('whitespace-pre-wrap');
  });

  it("marks a chat title's tooltip as the person's words, never translated", () => {
    const { container } = wrap(
      <ConversationList
        conversations={[
          { id: 'a', title: 'Trip to Goa reel', updatedAt: 2 },
          { id: 'b', title: '  ', updatedAt: 1 },
        ]}
        renderLink={(conversation, props) => (
          <a href={`#${conversation.id}`} {...props}>
            {props.children}
          </a>
        )}
      />,
    );
    // The row's tooltip carries the same words as its UserContent: both are data (card protocol rule 2).
    const titled = container.querySelector('span[title="Trip to Goa reel"]');
    expect(titled?.getAttribute('translate')).toBe('no');
    // An untitled chat shows "New chat", which is UI text: no tooltip and nothing kept from translation.
    const untitled = screen.getAllByRole('link')[1]?.querySelector('span');
    expect(untitled?.getAttribute('title')).toBeNull();
    expect(untitled?.getAttribute('translate')).toBeNull();
  });
});
