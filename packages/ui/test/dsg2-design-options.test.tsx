// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// DSG2: a graphic that came with three designs, in the chat: the card shows each as a tile (a still over the
// person's video, its number, name and idea), marks the one in the video, swaps another in with one click
// (graphics.chooseOption), asks for three new ones (Try again) and keeps a graphic without options on the designed
// graphic card. Made-up designs only (fixtures-design-options.ts).
import type { CardOf, GraphicItem, Id, RunId, Timeline } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardView,
  DESIGN_OPTION_COMPOSITIONS,
  DESIGN_OPTION_IDS,
  DESIGN_OPTIONS_SET,
  DesignOptionPicker,
} from '../src/index';
import { makeTimeline, ok, RATE, timelineData, wrap } from './make-fixture';

const ITEM = DESIGN_OPTION_IDS.graphic;
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as RunId;
const BASE = makeTimeline({ slots: 3 });
const [FIRST, SECOND, THIRD] = DESIGN_OPTION_COMPOSITIONS;
const target = { projectId: BASE.projectId, timelineId: BASE.id, itemId: ITEM };
const chip = { kind: 'item', timelineId: BASE.id, itemId: ITEM, itemKind: 'graphic' };

const optionsCard = (overrides: Partial<CardOf<'motionGraphic'>> = {}): CardOf<'motionGraphic'> => ({
  type: 'motionGraphic',
  id: 'design-options',
  version: 1,
  runId: RUN,
  projectId: BASE.projectId,
  timelineId: BASE.id,
  itemId: ITEM,
  composition: { id: FIRST.id, name: FIRST.name },
  start: { value: 30, rate: RATE },
  duration: { value: 45, rate: RATE },
  unmatched: [],
  options: DESIGN_OPTION_COMPOSITIONS.map((design, index) => ({
    compositionId: design.id,
    name: design.name,
    idea: DESIGN_OPTIONS_SET.designs[index]!.idea,
  })),
  ...overrides,
});

/** The timeline with the title on a text track, drawn with `inUse`, and the three copies. */
function withOptions(inUse = FIRST, extra: Partial<GraphicItem> = {}): Timeline {
  const item: GraphicItem = {
    type: 'graphic',
    id: ITEM,
    anchor: { kind: 'time', at: { value: 30, rate: RATE } },
    start: { value: 30, rate: RATE },
    duration: { value: 45, rate: RATE },
    placement: { box: { x: 0, y: 0, width: 1, height: 1 } },
    styleKey: 'composition',
    language: null,
    origin: 'agent',
    composition: { id: inUse.id, hash: inUse.hash, params: { title: 'Golden hour market' } },
    options: DESIGN_OPTIONS_SET,
    ...extra,
  };
  return {
    ...BASE,
    tracks: [...BASE.tracks, { kind: 'text', id: 'T2', name: '', enabled: true, items: [item] }],
    graphicCompositions: [...DESIGN_OPTION_COMPOSITIONS],
  };
}

const tiles = () =>
  within(screen.getByRole('group', { name: 'Designs to choose from' })).getAllByRole('button');

describe('a graphic’s three designs in the chat (DSG2)', () => {
  it('shows each design as a tile with its name and idea, and marks the one in the video', () => {
    wrap(<CardView card={optionsCard()} />, { dispatch: vi.fn() }, timelineData(withOptions()));
    expect(screen.getByRole('heading', { name: FIRST.name })).toBeTruthy();
    const [first, second, third] = tiles();
    expect(tiles()).toHaveLength(3);
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(second?.getAttribute('aria-pressed')).toBe('false');
    expect(first?.textContent).toContain('In your video');
    expect(second?.textContent).not.toContain('In your video');
    // Each is named for a screen reader by its number and the model's words, described by its idea.
    expect(screen.getByRole('button', { name: `Design 2 of 3: ${SECOND.name}` })).toBe(second);
    expect(third?.getAttribute('aria-describedby')).toBeTruthy();
    expect(third?.textContent).toContain(DESIGN_OPTIONS_SET.designs[2]!.idea);
    for (const content of first!.querySelectorAll('[data-user-content]'))
      expect(content.getAttribute('translate')).toBe('no');
    expect(screen.getByText('Pick the design you like. The marked one is in your video now.')).toBeTruthy();
    // It is in the video already: nothing to "use", and no proposal band.
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull();
    expect(document.querySelector('[data-slot=design-proposal]')).toBeNull();
  });

  it('one click swaps another design in, and the one in the video does nothing', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={optionsCard()} />, { dispatch }, timelineData(withOptions()));
    fireEvent.click(tiles()[0]!);
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(tiles()[2]!);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('graphics.chooseOption', { ...target, compositionId: THIRD.id }),
    );
    await waitFor(() => expect(screen.getByText('Switched to this design.')).toBeTruthy());
  });

  it('marks the design the timeline says is in use, whatever the card first said', () => {
    wrap(<CardView card={optionsCard()} />, { dispatch: vi.fn() }, timelineData(withOptions(SECOND)));
    expect(tiles().map((tile) => tile.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(screen.getByRole('heading', { name: SECOND.name })).toBeTruthy();
  });

  it('Try again asks the run for new designs with the graphic as a chip; Change… opens the composer', async () => {
    const followUp = vi.fn(() => Promise.resolve(ok()));
    const ask = vi.fn();
    wrap(
      <CardView card={optionsCard()} />,
      { dispatch: vi.fn(), followUp, ask },
      timelineData(withOptions()),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(followUp).toHaveBeenCalledWith(RUN, 'Try again: design this graphic another way.', [chip]),
    );
    await waitFor(() => expect(screen.getByText('Asked for three new designs.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    expect(ask).toHaveBeenCalledWith('Change this graphic: ', [chip]);
  });

  it('reads each still from the workspace once and shows it on its tile', async () => {
    const designStill = vi.fn((_project: string, sha256: string) =>
      Promise.resolve(`data:image/jpeg;base64,${sha256}`),
    );
    wrap(
      <CardView card={optionsCard()} />,
      { dispatch: vi.fn() },
      timelineData(withOptions(), { designStill }),
    );
    await waitFor(() => expect(designStill).toHaveBeenCalledTimes(3));
    expect(designStill).toHaveBeenCalledWith(BASE.projectId, DESIGN_OPTION_IDS.stills[1]);
    await waitFor(() =>
      expect(tiles()[1]?.querySelector('img')?.getAttribute('src')).toBe(
        `data:image/jpeg;base64,${DESIGN_OPTION_IDS.stills[1]}`,
      ),
    );
  });

  it('is a record without a command bus, and says so when the graphic is gone', () => {
    const { unmount } = wrap(<CardView card={optionsCard()} />, {}, timelineData(withOptions()));
    expect(tiles().every((tile) => (tile as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    unmount();
    wrap(<CardView card={optionsCard()} />, { dispatch: vi.fn() }, timelineData(BASE));
    expect(screen.getByText('The graphic isn’t on the timeline now.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Designs to choose from' })).toBeNull();
  });

  it('a graphic without designs to choose between keeps the designed graphic card', () => {
    const { options: _none, ...plain } = withOptions().tracks.at(-1)!.items[0] as GraphicItem;
    const timeline: Timeline = {
      ...BASE,
      tracks: [...BASE.tracks, { kind: 'text', id: 'T2', name: '', enabled: true, items: [plain] }],
      graphicCompositions: [FIRST],
    };
    wrap(<CardView card={optionsCard()} />, { dispatch: vi.fn() }, timelineData(timeline));
    expect(screen.queryByRole('group', { name: 'Designs to choose from' })).toBeNull();
    expect(screen.getByText('Starts at 00:01.00 · lasts 1.5s')).toBeTruthy();
  });

  it('one design in the video is nothing to choose yet: the picker comes with the second', () => {
    // A set starts with the first design placed and grows as the others are.
    const one = { ...DESIGN_OPTIONS_SET, designs: DESIGN_OPTIONS_SET.designs.slice(0, 1) };
    const { options: _first, ...card } = optionsCard();
    const view = wrap(<CardView card={card} />, { dispatch: vi.fn() }, timelineData(withOptions(FIRST, { options: one })));
    expect(screen.queryByRole('group', { name: 'Designs to choose from' })).toBeNull();
    expect(screen.getByText('Starts at 00:01.00 · lasts 1.5s')).toBeTruthy();
    view.unmount();
    const two = { ...DESIGN_OPTIONS_SET, designs: DESIGN_OPTIONS_SET.designs.slice(0, 2) };
    wrap(<CardView card={card} />, { dispatch: vi.fn() }, timelineData(withOptions(FIRST, { options: two })));
    expect(tiles()).toHaveLength(2);
  });

  it('the picker alone: the tile being swapped in is busy and the others wait', () => {
    const choose = vi.fn();
    const views = DESIGN_OPTION_COMPOSITIONS.map((design, index) => ({
      compositionId: design.id as string,
      name: design.name,
      idea: DESIGN_OPTIONS_SET.designs[index]!.idea,
      still: null,
      inUse: index === 0,
    }));
    wrap(
      <DesignOptionPicker
        options={views}
        aspect={9 / 16}
        disabled={false}
        busy={SECOND.id}
        onChoose={choose}
      />,
    );
    const [first, second, third] = tiles() as HTMLButtonElement[];
    expect(second?.getAttribute('aria-busy')).toBe('true');
    expect(first?.disabled).toBe(true);
    expect(third?.disabled).toBe(true);
    fireEvent.click(second!);
    expect(choose).not.toHaveBeenCalled();
  });
});

// Keeps the id type in use where a fixture names a graphic by hand.
export type { Id };
