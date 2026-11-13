// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardView, MAKE_FIXTURE_IDS, stepClock, type CardData } from '../src/index';
import { ok, failed, wrap } from './make-fixture';
import {
  card,
  compareData,
  LENGTH_MS,
  ORIGINAL,
  PROJECT,
  renderSnapshot,
  SECOND,
  THIRD,
  timelineAt,
  withPlayer,
} from './variants-fixture';

const timelines = [timelineAt(ORIGINAL, 3), timelineAt(SECOND), timelineAt(THIRD)];
const tile = (timelineId: string) =>
  document.querySelector<HTMLElement>(`[data-slot=variant-tile][data-timeline="${timelineId}"]`)!;
const players = () => screen.getAllByTestId(/^player-/);

afterEach(() => vi.useRealTimers());

describe('variantsCompare card (U1)', () => {
  it('labels every video and says what differs in words, with the AI mark and the length', () => {
    wrap(<CardView card={card()} />, {}, compareData(timelines));
    expect(screen.getByRole('article', { name: 'Your variants' })).toBeTruthy();
    const original = within(tile(ORIGINAL));
    expect(original.getByText('Original')).toBeTruthy();
    expect(original.getByText('The video these were made from')).toBeTruthy();
    expect(original.queryByRole('img', { name: 'Made by the AI' })).toBeNull();
    const first = within(tile(SECOND));
    expect(first.getByText('Variant 1')).toBeTruthy();
    expect(first.getByText('New hook · Bold captions')).toBeTruthy();
    expect(first.getByText('40% different shots')).toBeTruthy();
    expect(first.getByRole('img', { name: 'Made by the AI' })).toBeTruthy();
    expect(first.getByText('4.5s')).toBeTruthy();
    const second = within(tile(THIRD));
    expect(second.getByText('Variant 2')).toBeTruthy();
    expect(second.getByText('No music in the file')).toBeTruthy();
    expect(second.getByText('25% different shots')).toBeTruthy();
  });

  it('Play the hooks drives every preview from one clock, loops them together and stops them together', () => {
    vi.useFakeTimers();
    withPlayer(<CardView card={card()} />, {}, compareData(timelines));
    expect(players()).toHaveLength(3);
    expect(players().every((player) => player.dataset.playing === 'false')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Play the hooks' }));
    const started = players().map((player) => player.dataset.epoch);
    expect(players().every((player) => player.dataset.playing === 'true')).toBe(true);
    expect(new Set(started).size).toBe(1);
    expect(screen.getByText('The first 3s of each, again and again')).toBeTruthy();

    // Every hook window, every player starts again at once.
    act(() => void vi.advanceTimersByTime(3000));
    const looped = players().map((player) => player.dataset.epoch);
    expect(new Set(looped).size).toBe(1);
    expect(Number(looped[0])).toBe(Number(started[0]) + 1);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(players().every((player) => player.dataset.playing === 'false')).toBe(true);
    act(() => void vi.advanceTimersByTime(6000));
    expect(players().every((player) => player.dataset.playing === 'false')).toBe(true);
  });

  it('Play all plays each video in turn for its length, then stops', () => {
    vi.useFakeTimers();
    withPlayer(<CardView card={card()} />, {}, compareData(timelines));
    fireEvent.click(screen.getByRole('button', { name: 'Play all' }));
    const playing = () => players().map((player) => player.dataset.playing === 'true');
    expect(playing()).toEqual([true, false, false]);
    expect(screen.getByText('Original, 1 of 3')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(LENGTH_MS));
    expect(playing()).toEqual([false, true, false]);
    act(() => void vi.advanceTimersByTime(LENGTH_MS));
    expect(playing()).toEqual([false, false, true]);
    act(() => void vi.advanceTimersByTime(LENGTH_MS));
    expect(playing()).toEqual([false, false, false]);
    expect(screen.getByRole('button', { name: 'Play all' })).toBeTruthy();
  });

  it('Export all dispatches one render.exportBatch with the original and every variant', async () => {
    const dispatch = vi.fn().mockResolvedValue(ok({ batchId: 'b', renderIds: [] }));
    wrap(<CardView card={card()} />, { dispatch }, compareData(timelines));
    fireEvent.click(screen.getByRole('button', { name: 'Export all' }));
    await screen.findByText('Exporting 3 videos. Find them in Exports.');
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [name, payload] = dispatch.mock.calls[0]!;
    expect(name).toBe('render.exportBatch');
    expect(payload).toEqual({
      batchId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      items: [ORIGINAL, SECOND, THIRD].map((timelineId) => ({ projectId: PROJECT, timelineId })),
      mode: 'export',
      notify: false,
    });
  });

  it('Export on a tile sends that video alone; a refusal shows its cause', async () => {
    const dispatch = vi.fn().mockResolvedValue(failed('render.batch_too_large'));
    wrap(<CardView card={card()} />, { dispatch }, compareData(timelines));
    fireEvent.click(screen.getByRole('button', { name: 'Export Variant 2' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(dispatch.mock.calls[0]![1]).toMatchObject({ items: [{ projectId: PROJECT, timelineId: THIRD }] });
  });

  it('Open goes to the editor at that video; without players, Compare side by side opens the compare view', () => {
    const navigate = vi.fn();
    wrap(<CardView card={card()} />, { navigate }, compareData(timelines));
    expect(screen.queryByRole('button', { name: 'Play the hooks' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Variant 1 in the editor' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: 'timeline', projectId: PROJECT, timelineId: SECOND });
    fireEvent.click(screen.getByRole('button', { name: 'Compare side by side' }));
    expect(navigate).toHaveBeenLastCalledWith({
      to: 'timeline',
      projectId: PROJECT,
      timelineId: ORIGINAL,
      compare: MAKE_FIXTURE_IDS.cast,
    });
  });

  it('says why fewer were made than asked', () => {
    wrap(
      <CardView card={card({ asked: 4, short: { axis: 'hook', asked: 4, made: 2 } })} />,
      {},
      compareData(timelines),
    );
    expect(screen.getByText('Made 2 of 4: your library ran out of different hooks')).toBeTruthy();
  });

  it('a deleted variant says so and its buttons are off', () => {
    const navigate = vi.fn();
    const dispatch = vi.fn();
    wrap(<CardView card={card()} />, { navigate, dispatch }, compareData(timelines.slice(0, 2)));
    const gone = tile(THIRD);
    expect(gone.dataset.state).toBe('deleted');
    expect(within(gone).getByText('This video was deleted.')).toBeTruthy();
    for (const button of within(gone).getAllByRole('button'))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(tile(SECOND).dataset.state).toBe('ready');
  });

  it('while making: bones for the rest, the step in words, Export all off', () => {
    const dispatch = vi.fn();
    wrap(
      <CardView card={card({ status: 'making', asked: 3, variants: card().variants.slice(0, 1) })} />,
      { dispatch },
      compareData(timelines),
    );
    expect(screen.getByText('Making variant 2 of 3…')).toBeTruthy();
    expect(document.querySelectorAll('[data-slot=variant-tile][data-state=making]')).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Export all' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks a video you changed after the card in teal, and follows each tile’s newest render', () => {
    const renders = {
      [SECOND]: renderSnapshot(SECOND, 'rendering', {
        progress: { fraction: 0.4, stageKey: 'render.stage.capturing' },
      }),
      [THIRD]: renderSnapshot(THIRD, 'ready'),
    };
    const data: CardData = compareData(
      [timelineAt(ORIGINAL, 5), timelineAt(SECOND), timelineAt(THIRD)],
      renders,
    );
    wrap(<CardView card={card()} />, {}, data);
    expect(within(tile(ORIGINAL)).getByText('You changed this')).toBeTruthy();
    expect(within(tile(SECOND)).queryByText('You changed this')).toBeNull();
    const bar = within(tile(SECOND)).getByRole('progressbar', { name: 'Export of Variant 1' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(within(tile(THIRD)).getByText('Exported')).toBeTruthy();
  });
});

describe('the hook clock', () => {
  it('loops the hooks, plays each in turn, and stops from anywhere', () => {
    const hooks = stepClock({ mode: 'stopped', epoch: 0, turn: 0 }, { type: 'hooks' });
    expect(hooks).toEqual({ mode: 'hooks', epoch: 1, turn: 0 });
    expect(stepClock(hooks, { type: 'tick', count: 3 })).toEqual({ mode: 'hooks', epoch: 2, turn: 0 });
    const all = stepClock(hooks, { type: 'all' });
    expect(stepClock(all, { type: 'tick', count: 2 })).toEqual({ mode: 'all', epoch: 3, turn: 1 });
    expect(stepClock({ mode: 'all', epoch: 3, turn: 1 }, { type: 'tick', count: 2 }).mode).toBe('stopped');
    expect(stepClock(all, { type: 'stop' }).mode).toBe('stopped');
  });
});
