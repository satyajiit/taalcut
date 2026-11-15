// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: pick the part. The window shows what the scene really plays; dragging it, clicking another moment and
 * stepping it send one command when the hand lets go (timeline.slipClip inside the shot, timeline.swapClip into
 * another shot of the same file); Escape puts it back; a refused command puts the window back and says why.
 */
import { EDITOR_COMMANDS, err, TIMELINE_COMMANDS, type TaalcutError } from '@taalcut/core';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipPart } from '../src/features/timeline/clip-part/clip-part';
import { HOLD_MS, SETTLE_MS } from '../src/features/timeline/clip-part/use-part-gestures';
import {
  FILE,
  fileLookup,
  layOutStrip,
  partFixture,
  SHOT_B,
  type PartFixtureOptions,
} from './clip-part-support';
import { pointer } from './other-shots-support';
import { mountEditorControl } from './simple-editor-support';

const RATE = { num: 30, den: 1 };

function mount(options: PartFixtureOptions = {}) {
  const f = partFixture(options);
  const view = mountEditorControl(
    <ClipPart clip={f.clip} model={f.model} edits={f.edits} lookup={fileLookup()} />,
  );
  const strip = view.container.querySelector('[data-slot=part-strip]')!;
  layOutStrip(strip);
  const part = screen.getByRole('slider', { name: 'The part scene 3 plays' });
  return { ...f, view, strip, part };
}

/** Lets a sent command come back. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** Presses on `target` at `from`, moves to `to` (a pixel of the strip is a frame of the file) and lets go. */
function drag(target: Element, from: number, to: number, drop = true) {
  pointer(target, 'pointerdown', { x: from, held: 1 });
  pointer(target, 'pointermove', { x: (from + to) / 2, held: 1 });
  pointer(target, 'pointermove', { x: to, held: 1 });
  if (drop) pointer(target, 'pointerup', { x: to });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pick the part: what it shows (TRIM1)', () => {
  it('shows the part the scene really plays, in seconds, as a window on the whole clip', () => {
    const { part } = mount();
    expect(screen.getByRole('heading', { name: 'Pick the part scene 3 plays' })).toBeTruthy();
    expect(screen.getByText('Plays 1.0s to 2.0s of a 10s clip')).toBeTruthy();
    // Frames 30 to 60 of 300: a tenth of the way in, a tenth wide.
    expect(part.style.left).toBe('10%');
    expect(part.style.width).toBe('10%');
    expect(part.getAttribute('aria-valuetext')).toBe('1.0s to 2.0s of 10s');
    expect(part.getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByRole('slider', { name: 'Where scene 3 begins' }).getAttribute('aria-valuetext')).toBe(
      'Begins 1.0s into the clip',
    );
    expect(screen.getByRole('slider', { name: 'Where scene 3 ends' }).getAttribute('aria-valuetext')).toBe(
      'Ends 2.0s into the clip',
    );
  });

  it('marks where the file’s shots change', () => {
    const { view } = mount();
    const cuts = [...view.container.querySelectorAll<HTMLElement>('[data-slot=part-cut]')];
    expect(cuts.map((cut) => cut.style.left)).toEqual(['40%']);
  });

  it('says truthfully what the scenes next to it do, and never in an editor’s words', () => {
    const { view } = mount();
    expect(
      screen.getByText(
        'Drag an end to make the scene longer or shorter: scene 2 or scene 4 makes room, and nothing else moves.',
      ),
    ).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/\b(slip|roll|ripple|in-point)\b/i);
  });
});

describe('pick the part: moving it (TRIM1)', () => {
  it('sends nothing while the window is dragged, then one timeline.slipClip with the first frame', async () => {
    const { part, command, clip } = mount();
    drag(part, 45, 65, false);
    expect(command).not.toHaveBeenCalled();
    expect(part.style.left).toBe(`${(50 / 300) * 100}%`);
    expect(screen.getByText('Plays 1.7s to 2.7s of a 10s clip')).toBeTruthy();
    expect(screen.getByText('Let go to play this part. Escape puts it back.')).toBeTruthy();
    pointer(part, 'pointerup', { x: 65 });
    await settle();
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(EDITOR_COMMANDS.slipClip, {
      clipId: clip.item.id,
      sourceStart: { value: 50, rate: RATE },
    });
    expect(screen.getByRole('status').textContent).toBe('Scene 3 now plays 1.7s to 2.7s.');
  });

  it('sends timeline.swapClip when the window lands in another shot of the same file', async () => {
    const { part, command, clip } = mount();
    drag(part, 45, 215);
    await settle();
    expect(command).toHaveBeenCalledWith(TIMELINE_COMMANDS.swapClip, {
      clipId: clip.item.id,
      media: { assetId: FILE, shotId: SHOT_B },
      sourceStart: { value: 200, rate: RATE },
      from: 'search',
    });
  });

  it('never leaves the window across a cut: it stays on the nearer side', async () => {
    const { part, command } = mount();
    // Frame 100 would play across the cut at frame 120.
    drag(part, 45, 115);
    await settle();
    expect(command.mock.calls[0]![1]).toMatchObject({ sourceStart: { value: 90 } });
  });

  it('starts the part where the strip is pressed', async () => {
    const { strip, command, clip } = mount();
    pointer(strip, 'pointerdown', { x: 75, held: 1 });
    pointer(strip, 'pointerup', { x: 75 });
    await settle();
    expect(command).toHaveBeenCalledWith(EDITOR_COMMANDS.slipClip, {
      clipId: clip.item.id,
      sourceStart: { value: 75, rate: RATE },
    });
  });

  it('sends nothing for a press that moves nothing', async () => {
    const { part, command } = mount();
    drag(part, 45, 45);
    await settle();
    expect(command).not.toHaveBeenCalled();
  });

  it('puts the window back on Escape, and keeps the Escape from the editor', async () => {
    const { part, command } = mount();
    const editor = vi.fn();
    window.addEventListener('keydown', editor);
    drag(part, 45, 105, false);
    expect(part.style.left).not.toBe('10%');
    fireEvent.keyDown(part, { key: 'Escape' });
    expect(part.style.left).toBe('10%');
    pointer(part, 'pointerup', { x: 105 });
    await settle();
    window.removeEventListener('keydown', editor);
    expect(command).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(screen.getByText('Plays 1.0s to 2.0s of a 10s clip')).toBeTruthy();
  });

  it('puts the window back when the command is refused, and says why beside it', async () => {
    const { part, command, edits } = mount();
    const refusal = { code: 'timeline.invalid_move', message: 'no', detail: 'outside the shot' };
    command.mockResolvedValueOnce(err(refusal as unknown as TaalcutError));
    drag(part, 45, 65);
    await settle();
    expect(part.style.left).toBe('10%');
    expect(screen.getByRole('alert').textContent).toBe(
      'That part doesn’t fit inside one shot of the clip. Pick a part inside it, or make the scene shorter first.',
    );
    // Said once, here: not again under the transport.
    expect(edits.clearError).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
    // The next try clears it.
    drag(part, 45, 55, false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the window where it was dropped until the timeline answers, and no longer', async () => {
    const { part } = mount();
    drag(part, 45, 65);
    await settle();
    expect(part.style.left).toBe(`${(50 / 300) * 100}%`);
    // This timeline never changes (the fixture's edits change nothing): the truth comes back.
    await wait(HOLD_MS);
    expect(part.style.left).toBe('10%');
  });
});

describe('pick the part: fine steps (TRIM1)', () => {
  it('steps a frame or half a second with the buttons, as one command once the presses stop', async () => {
    const { command, clip } = mount();
    fireEvent.click(screen.getByRole('button', { name: '1 frame later' }));
    fireEvent.click(screen.getByRole('button', { name: '1 frame later' }));
    fireEvent.click(screen.getByRole('button', { name: '0.5s later' }));
    expect(screen.getByText('Plays 1.6s to 2.6s of a 10s clip')).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    await wait(SETTLE_MS);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(EDITOR_COMMANDS.slipClip, {
      clipId: clip.item.id,
      sourceStart: { value: 47, rate: RATE },
    });
  });

  it('steps earlier too, and stops at the clip’s first frame', async () => {
    const { command } = mount();
    const back = screen.getByRole('button', { name: '0.5s earlier' });
    fireEvent.click(back);
    fireEvent.click(back);
    fireEvent.click(back);
    fireEvent.click(screen.getByRole('button', { name: '1 frame earlier' }));
    await wait(SETTLE_MS);
    expect(command.mock.calls[0]![1]).toMatchObject({ sourceStart: { value: 0 } });
  });

  it('steps with the arrow keys (Shift for half a second); Return sends at once', async () => {
    const { part, command } = mount();
    fireEvent.keyDown(part, { key: 'ArrowRight' });
    fireEvent.keyDown(part, { key: 'ArrowLeft' });
    fireEvent.keyDown(part, { key: 'ArrowRight' });
    fireEvent.keyDown(part, { key: 'ArrowRight', shiftKey: true });
    expect(part.getAttribute('aria-valuetext')).toBe('1.5s to 2.5s of 10s');
    expect(command).not.toHaveBeenCalled();
    fireEvent.keyDown(part, { key: 'Enter' });
    await settle();
    expect(command.mock.calls[0]![1]).toMatchObject({ sourceStart: { value: 46 } });
  });

  it('goes to the first and last place in its shot with Home and End, and on to the next shot from there', async () => {
    const { part, command } = mount();
    fireEvent.keyDown(part, { key: 'End' });
    expect(part.getAttribute('aria-valuetext')).toBe('3.0s to 4.0s of 10s');
    fireEvent.keyDown(part, { key: 'ArrowRight' });
    // The next frame it fits at is the second shot's first.
    expect(part.getAttribute('aria-valuetext')).toBe('4.0s to 5.0s of 10s');
    await wait(SETTLE_MS);
    expect(command.mock.calls[0]![0]).toBe(TIMELINE_COMMANDS.swapClip);
    // (The fixture's timeline never moves on: the window is back where the scene plays.)
    await wait(HOLD_MS);
    fireEvent.keyDown(part, { key: 'Home' });
    await wait(SETTLE_MS);
    expect(command.mock.calls[1]![1]).toMatchObject({ sourceStart: { value: 0 } });
  });

  it('takes a step pressed while the last change is on its way, once that has landed', async () => {
    const { command } = mount();
    const later = screen.getByRole('button', { name: '1 frame later' });
    fireEvent.click(later);
    await wait(SETTLE_MS);
    expect(command).toHaveBeenCalledTimes(1);
    // Still on its way: the press is kept, not dropped.
    fireEvent.click(later);
    expect(later.hasAttribute('disabled')).toBe(false);
    await wait(HOLD_MS);
    await wait(SETTLE_MS);
    expect(command).toHaveBeenCalledTimes(2);
  });

  it('puts unsent steps back on Escape, and sends them when the control is left', async () => {
    const { part, command, view } = mount();
    fireEvent.keyDown(part, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(part, { key: 'Escape' });
    await wait(SETTLE_MS);
    expect(command).not.toHaveBeenCalled();
    expect(part.getAttribute('aria-valuetext')).toBe('1.0s to 2.0s of 10s');
    fireEvent.keyDown(part, { key: 'ArrowRight' });
    view.unmount();
    await settle();
    expect(command).toHaveBeenCalledTimes(1);
  });
});
