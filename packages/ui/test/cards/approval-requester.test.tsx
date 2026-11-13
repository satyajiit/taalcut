// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V4: an external agent's approval names the agent as the person named its session (never translated) and opens
// Settings › External agents at that session; the built-in agent's approvals stay as they were.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardActionsProvider, CardView, type CardActions } from '../../src/index';

const answered = { ok: true as const, value: 'answered' as const };

const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );
const approval = (name: string): CardOf<'approval'> => {
  const card = CARD_FIXTURES.approval[name];
  if (!card) throw new Error(`no approval fixture ${name}`);
  return card;
};

describe('approval card from an external agent', () => {
  it('says who is asking, the name as written and not translated', () => {
    const { container } = wrap(<CardView card={approval('external')} />, {
      decide: vi.fn().mockResolvedValue(answered),
    });
    const line = container.querySelector('[data-slot="approval-requester"]');
    expect(line?.textContent).toBe('Claude Code (an external agent) is asking');
    const name = line?.querySelector('[translate="no"]');
    expect(name?.textContent).toBe('Claude Code');
    // Only the name is left untranslated: the rest of the line is the app's words.
    expect(line?.getAttribute('translate')).toBeNull();
  });

  it('opens External agents at that session', async () => {
    const navigate = vi.fn();
    const card = approval('external');
    wrap(<CardView card={card} />, { decide: vi.fn().mockResolvedValue(answered), navigate });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change what Claude Code can do' }));
    });
    expect(navigate).toHaveBeenCalledWith({
      to: 'settings',
      section: 'external-agents',
      sessionId: card.requester?.sessionId,
    });
  });

  it('keeps a 60-character name whole: the line wraps, the button names it in full', () => {
    const card = approval('externalLongName');
    const name = card.requester?.name ?? '';
    expect(name).toHaveLength(60);
    const { container } = wrap(<CardView card={card} />, {
      decide: vi.fn().mockResolvedValue(answered),
      navigate: vi.fn(),
    });
    const line = container.querySelector('[data-slot="approval-requester"]');
    expect(line?.textContent).toBe(`${name} (an external agent) is asking`);
    expect(line?.className).toContain('[overflow-wrap:anywhere]');
    expect(screen.getByRole('button', { name: `Change what ${name} can do` })).toBeTruthy();
  });

  it("leaves the built-in agent's approvals as they were", () => {
    const { container } = wrap(<CardView card={approval('pending')} />, {
      decide: vi.fn().mockResolvedValue(answered),
      navigate: vi.fn(),
    });
    expect(container.querySelector('[data-slot="approval-requester"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Change what/ })).toBeNull();
  });
});
