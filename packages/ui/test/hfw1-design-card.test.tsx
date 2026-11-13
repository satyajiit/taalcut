// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// HFW1-UI: a graphic the AI designed, in the chat: its card is named by its design (never a kind), leads with the
// proposal (a still, its name and when it plays, Use it, Try again, Change…). Editing opens the video; the chat
// has no duplicate text or timing fields. The changes card's design row says "Chat bubble · new design
// v1 → v2 · proposed" and has View files. Made-up designs only (fixtures-designs.ts).
import type { CardOf, GraphicItem, Id, Timeline } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView, DESIGN_COMPOSITIONS, designValues, variableWords } from '../src/index';
import { DesignVariablesForm } from '../src/media/design-variables';
import { makeTimeline, ok, RATE, timelineData, wrap } from './make-fixture';

const ITEM = '01K7C5M6Q8R9S0T1V2W3X4MG01' as Id<'TimelineItem'>;
const BASE = makeTimeline({ slots: 3 });
const target = { projectId: BASE.projectId, timelineId: BASE.id, itemId: ITEM };

const COMPOSITION = DESIGN_COMPOSITIONS.priceTag;

const designCard = (overrides: Partial<CardOf<'motionGraphic'>> = {}): CardOf<'motionGraphic'> => ({
  type: 'motionGraphic',
  id: 'design',
  version: 1,
  projectId: BASE.projectId,
  timelineId: BASE.id,
  itemId: ITEM,
  composition: { id: COMPOSITION.id, name: COMPOSITION.name },
  start: { value: 30, rate: RATE },
  duration: { value: 45, rate: RATE },
  unmatched: [],
  ...overrides,
});

/** The timeline with the designed graphic on a text track, and the copy it draws with. */
function withDesign(proposed: boolean, params: Record<string, string> = {}) {
  const item: GraphicItem = {
    type: 'graphic',
    id: ITEM,
    anchor: { kind: 'time', at: { value: 30, rate: RATE } },
    start: { value: 30, rate: RATE },
    duration: { value: 45, rate: RATE },
    placement: 'bottom',
    styleKey: 'composition',
    language: null,
    origin: 'agent',
    composition: { id: COMPOSITION.id, hash: COMPOSITION.hash, params: { item: 'Jasmine', ...params } },
    ...(proposed
      ? { proposal: { request: 'put the price on screen', design: 'designed', createdAt: 0 } }
      : {}),
  };
  const timeline: Timeline = {
    ...BASE,
    tracks: [...BASE.tracks, { kind: 'text', id: 'T2', name: '', enabled: true, items: [item] }],
    graphicCompositions: [COMPOSITION],
  };
  return timeline;
}

describe('a designed graphic’s card (HFW1-UI)', () => {
  it('is named by its design, as written, and leads with the proposal', () => {
    wrap(<CardView card={designCard()} />, {}, timelineData(withDesign(true)));
    const heading = screen.getByRole('heading', { name: 'Price tag' });
    expect(heading.querySelector('[data-user-content]')?.getAttribute('translate')).toBe('no');
    const proposal = document.querySelector('[data-slot=design-proposal]')!;
    expect(proposal.textContent).toContain('Proposed: it plays in the viewer and isn’t in your video yet.');
    expect(proposal.textContent).toContain('Plays from 00:01 to 00:02');
    expect(screen.queryByText(/Counter|Lower third/)).toBeNull();
  });

  it('Use it dispatches graphics.useProposal for it', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={designCard()} />, { dispatch }, timelineData(withDesign(true)));
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith('graphics.useProposal', target));
  });

  it('Change… puts the graphic in the composer as a chip', () => {
    const ask = vi.fn();
    wrap(<CardView card={designCard()} />, { ask, dispatch: vi.fn() }, timelineData(withDesign(true)));
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    expect(ask).toHaveBeenCalledWith('Change this graphic: ', [
      { kind: 'item', timelineId: BASE.id, itemId: ITEM, itemKind: 'graphic' },
    ]);
  });

  it('opens the graphic beside the video without putting editing fields in chat', () => {
    const open = vi.fn();
    wrap(
      <CardView card={designCard()} />,
      { editTurn: { useStatus: () => 'applied', undo: vi.fn(), redo: vi.fn(), open } },
      timelineData(withDesign(false)),
    );
    expect(screen.getByText('Starts at 00:01.00 · lasts 1.5s')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Move it' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit in video' }));
    expect(open).toHaveBeenCalledWith(
      BASE.projectId,
      { kind: 'item', timelineId: BASE.id, itemId: ITEM, itemKind: 'graphic' },
      1,
    );
  });

  it('does not offer an editor action where the host cannot open it', () => {
    wrap(<CardView card={designCard()} />, {}, timelineData(withDesign(false)));
    expect(screen.queryByRole('button', { name: 'Edit in video' })).toBeNull();
  });

  it('the editor’s variable form saves changed words and refuses an empty one', async () => {
    const save = vi.fn(() => Promise.resolve(true));
    wrap(
      <DesignVariablesForm
        variables={COMPOSITION.variables}
        params={{ item: 'Jasmine' }}
        disabled={false}
        busy={null}
        error={null}
        onSave={save}
      />,
    );
    const item = screen.getByLabelText('Item');
    fireEvent.change(item, { target: { value: 'Masala chai' } });
    fireEvent.blur(item);
    await waitFor(() => expect(save).toHaveBeenCalledWith('variable.item', { item: 'Masala chai' }));
    await waitFor(() => expect(item.getAttribute('data-status')).toBe('success'));
    const price = screen.getByLabelText('Price');
    fireEvent.change(price, { target: { value: '  ' } });
    fireEvent.keyDown(price, { key: 'Enter' });
    expect(screen.getByText('Write something here.')).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('the editor’s variable form saves a colour once it is picked', async () => {
    const save = vi.fn(() => Promise.resolve(true));
    wrap(
      <DesignVariablesForm
        variables={COMPOSITION.variables}
        params={{ item: 'Jasmine' }}
        disabled={false}
        busy={null}
        error={null}
        onSave={save}
      />,
    );
    const accent = screen.getByLabelText('Accent') as HTMLInputElement;
    fireEvent.input(accent, { target: { value: '#112233' } });
    expect(save).not.toHaveBeenCalled();
    accent.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('variable.accent', { accent: '#112233' }));
  });

  it('the editor’s variable form saves a choice and a flag at once', async () => {
    const bubble = DESIGN_COMPOSITIONS.bubble;
    const save = vi.fn(() => Promise.resolve(true));
    wrap(
      <DesignVariablesForm
        variables={bubble.variables}
        params={{}}
        disabled={false}
        busy={null}
        error={null}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Right' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('variable.side', { side: 'right' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Ticks' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('variable.ticks', { ticks: true }));
  });

  it('the design pieces read values and words the way the card shows them', () => {
    expect(designValues(COMPOSITION.variables, { item: 'Figs', accent: 3 })).toEqual({
      item: 'Figs',
      price: '₹120 a dozen',
      accent: '#e4572e',
    });
    expect(variableWords('accentColour')).toBe('Accent colour');
    expect(variableWords('line2')).toBe('Line 2');
  });
});

describe('the changes card’s design row (HFW1-UI)', () => {
  const card = CARD_FIXTURES.editChanges['new design']!;

  it('names the design, not a kind, and opens its files', () => {
    const openFiles = vi.fn();
    wrap(<CardView card={card} />, {
      editTurn: {
        useStatus: () => 'applied',
        undo: vi.fn(),
        redo: vi.fn(),
        open: vi.fn(),
        openFiles,
      },
    });
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]!.textContent).toBe('Chat bubble · new design v1 → v2 · proposedView files');
    fireEvent.click(screen.getByRole('button', { name: /^View files/ }));
    expect(openFiles).toHaveBeenCalledWith(card.projectId, card.changes[0]!.target);
    // Only the design row has files to view.
    expect(screen.getAllByRole('button', { name: /^View files/ })).toHaveLength(1);
  });

  it('has no View files where the app can’t open them', () => {
    wrap(<CardView card={card} />);
    expect(screen.queryByRole('button', { name: /View files/ })).toBeNull();
    expect(screen.getAllByRole('listitem')[0]!.textContent).toBe(
      'Chat bubble · new design v1 → v2 · proposed',
    );
  });
});
