// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EDT1-CTX's changes card: each change in plain words with its before and after, each row opening its item, and
// the whole turn undone, redone or kept as one step, as the history says it stands.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  CardView,
  type CardActions,
  type CardEditTurn,
  type EditTurnStatus,
} from '../../src/index';

const done = { ok: true as const, value: undefined };
const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );
const fixture = (name: string): CardOf<'editChanges'> => {
  const card = CARD_FIXTURES.editChanges[name];
  if (!card) throw new Error(`no editChanges fixture ${name}`);
  return card;
};
const turn = (status: EditTurnStatus) => {
  const actions = {
    useStatus: () => status,
    undo: vi.fn<CardEditTurn['undo']>().mockResolvedValue(done),
    redo: vi.fn<CardEditTurn['redo']>().mockResolvedValue(done),
    open: vi.fn<CardEditTurn['open']>(),
  };
  return actions satisfies CardEditTurn;
};
const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('editChanges card', () => {
  it('words each change with its before and after', () => {
    wrap(<CardView card={fixture('many')} />);
    expect(screen.getByRole('heading', { name: 'What changed' })).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Opening title: “Morning in the hills” → “Sunrise run”',
      'Graphic 1: moved to the top',
      'Clip 4: 1× → 0.5×',
      'Transition 2: added',
      'Clip 2: moved from place 5 to 2',
      'Audio 1: 0 dB → -6 dB',
      'The captions changed',
    ]);
    expect(screen.getByText('And 3 more.')).toBeTruthy();
    wrap(<CardView card={fixture('shorter')} />);
    expect(
      screen
        .getAllByText(/Clip 3/)
        .at(-1)
        ?.closest('li')?.textContent,
    ).toBe('Clip 3: 2.4s → 1.8s');
  });

  it('words a graphic’s new design (HFW1), its name as the model wrote it', () => {
    const card = fixture('shorter');
    const row = card.changes[0]!;
    const design = (proposed: boolean) => ({
      ...row,
      target: { ...row.target, itemKind: 'graphic' } as typeof row.target,
      number: 2,
      change: {
        kind: 'design' as const,
        before: { name: 'Chat bubble', version: 1 },
        after: { name: 'Chat bubble', version: 2 },
        proposed,
      },
    });
    wrap(<CardView card={{ ...card, id: 'edit-changes-design', changes: [design(true), design(false)] }} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      // HFW1-UI: named by its design, not "Graphic 2".
      'Chat bubble · new design v1 → v2 · proposed',
      'Chat bubble · new design v1 → v2',
    ]);
  });

  it('opens a row’s item, and settles cleanly without inline Undo all or Keep buttons', async () => {
    const actions = turn('applied');
    const card = fixture('shorter');
    wrap(<CardView card={card} />, { editTurn: actions });
    await press('Clip 3: 2.4s → 1.8s');
    expect(actions.open).toHaveBeenCalledWith(card.projectId, card.changes[0]!.target, 3);
    expect(screen.queryByRole('button', { name: 'Undo all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
  });

  it('shows the Undone chip and disables row buttons when undone', () => {
    const actions = turn('undone');
    const card = fixture('many');
    wrap(<CardView card={card} />, { editTurn: actions });
    expect(screen.getByText('Undone')).toBeTruthy();
    expect(screen.getByText('This step was undone in History.')).toBeTruthy();
    // An undone turn's items aren't there to open.
    expect(screen.queryByRole('button', { name: /Opening title/ })).toBeNull();
  });

  it('says when nothing on the timeline changed', () => {
    wrap(<CardView card={fixture('nothing')} />);
    expect(screen.getByText('Nothing on the timeline changed.')).toBeTruthy();
  });
});
