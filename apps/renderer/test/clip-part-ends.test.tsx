// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the part's ends. Dragging or stepping an end is one timeline.trimClip when the hand lets go; while it
 * moves the control says how long the scene would last, which scene makes room, and why it goes no further.
 */
import { err, MIN_CLIP_FRAMES, type TaalcutError } from '@taalcut/core';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipPart } from '../src/features/timeline/clip-part/clip-part';
import { SETTLE_MS } from '../src/features/timeline/clip-part/use-part-gestures';
import { fileLookup, layOutStrip, partFixture, type PartFixtureOptions } from './clip-part-support';
import { pointer } from './other-shots-support';
import { mountEditorControl } from './simple-editor-support';

function mount(options: PartFixtureOptions = {}) {
  const f = partFixture(options);
  const view = mountEditorControl(
    // With its filmstrip, so the lines are the gesture's alone (a file without one adds its own line).
    <ClipPart clip={f.clip} model={f.model} edits={f.edits} lookup={fileLookup({ strip: 10 })} />,
  );
  layOutStrip(view.container.querySelector('[data-slot=part-strip]')!);
  const n = f.clip.number;
  return {
    ...f,
    view,
    end: screen.getByRole('slider', { name: `Where scene ${n} ends` }),
    start: screen.queryByRole('slider', { name: `Where scene ${n} begins` }),
  };
}

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const says = (view: { container: HTMLElement }) =>
  [...view.container.querySelectorAll('[data-slot=part-says] p')].map((line) => line.textContent);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pick the part: its ends (TRIM1)', () => {
  it('makes the scene end later with one timeline.trimClip, and says who makes room while it moves', async () => {
    const { end, edits, clip, view } = mount();
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 69, held: 1 });
    expect(edits.trim).not.toHaveBeenCalled();
    expect(screen.getByText('Plays 1.0s to 2.3s of a 10s clip')).toBeTruthy();
    expect(says(view)).toEqual([
      'The scene would last 1.3s.',
      'Scene 4 gets 0.3s shorter. Nothing else moves.',
    ]);
    pointer(end, 'pointerup', { x: 69 });
    await settle();
    expect(edits.trim).toHaveBeenCalledTimes(1);
    expect(edits.trim).toHaveBeenCalledWith(clip.item.id, 'end', 9);
    expect(edits.command).not.toHaveBeenCalled();
  });

  it('makes the scene end sooner, and the scene after it longer', async () => {
    const { end, edits, clip, view } = mount();
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 45, held: 1 });
    expect(says(view)[1]).toBe('Scene 4 gets 0.5s longer. Nothing else moves.');
    pointer(end, 'pointerup', { x: 45 });
    await settle();
    expect(edits.trim).toHaveBeenCalledWith(clip.item.id, 'end', -15);
  });

  it('makes the scene begin earlier in the clip: the scene before it makes room', async () => {
    const { start, edits, clip, view } = mount();
    pointer(start!, 'pointerdown', { x: 30, held: 1 });
    pointer(start!, 'pointermove', { x: 21, held: 1 });
    expect(screen.getByText('Plays 0.7s to 2.0s of a 10s clip')).toBeTruthy();
    expect(says(view)[1]).toBe('Scene 2 gets 0.3s shorter. Nothing else moves.');
    pointer(start!, 'pointerup', { x: 21 });
    await settle();
    expect(edits.trim).toHaveBeenCalledWith(clip.item.id, 'start', 9);
  });

  it('stops where the scene would get too short, and says so', async () => {
    const { end, edits, clip, view } = mount();
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 10, held: 1 });
    expect(says(view).at(-1)).toBe('The scene is too short to lose more.');
    pointer(end, 'pointerup', { x: 10 });
    await settle();
    expect(edits.trim).toHaveBeenCalledWith(clip.item.id, 'end', -(30 - MIN_CLIP_FRAMES));
  });

  it('stops where the clip or the scene beside it runs out, and says which', async () => {
    const { end, model, view } = mount();
    const after = model.positions[3]!;
    const gives = after.end - after.start - MIN_CLIP_FRAMES;
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 299, held: 1 });
    // The file has eight more seconds; the scene after this one has far less to give.
    expect(gives).toBeLessThan(240);
    expect(says(view).at(-1)).toBe('Scene 4 is too short to give up more.');
    expect(screen.getByRole('slider', { name: 'Where scene 3 ends' }).style.left).toBe(
      `${((60 + gives) / 300) * 100}%`,
    );
  });

  it('offers no beginning to drag in the video’s first scene, and says why', () => {
    const { start, end, view } = mount({ index: 0 });
    expect(start).toBeNull();
    expect(end).toBeTruthy();
    expect(view.container.querySelector('[data-slot=part-edge-fixed]')).toBeTruthy();
    expect(
      screen.getByText('The video starts with this scene, so only its end can be dragged.'),
    ).toBeTruthy();
  });

  it('makes the video longer or shorter at the last scene’s end', async () => {
    const last = partFixture().model.clips.length - 1;
    const { end, view } = mount({ index: last });
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 75, held: 1 });
    expect(says(view)[1]).toBe('The video gets 0.5s longer.');
  });

  it('steps an end with the arrow keys: a frame, or half a second with Shift', async () => {
    const { end, edits, clip } = mount();
    fireEvent.keyDown(end, { key: 'ArrowRight' });
    fireEvent.keyDown(end, { key: 'ArrowRight', shiftKey: true });
    expect(end.getAttribute('aria-valuetext')).toBe('Ends 2.5s into the clip');
    expect(edits.trim).not.toHaveBeenCalled();
    await wait(SETTLE_MS);
    expect(edits.trim).toHaveBeenCalledWith(clip.item.id, 'end', 16);
  });

  it('lands an end on the beat when the video follows one', async () => {
    const { end, edits, model, clip, view } = mount({ beats: true });
    expect(model.beats.length).toBeGreaterThan(0);
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 61, held: 1 });
    expect(says(view)).toContain('The video follows a beat, so the end lands on the nearest beat.');
    pointer(end, 'pointerup', { x: 61 });
    await settle();
    // A frame off the beat is no change at all: nothing is sent.
    expect(edits.trim).not.toHaveBeenCalled();
    fireEvent.keyDown(end, { key: 'ArrowLeft' });
    await wait(SETTLE_MS);
    const by = vi.mocked(edits.trim).mock.calls[0]![2];
    // One step is the beat before: the cut is on the grid again.
    expect(by).toBeLessThan(-1);
    expect(clip.end + by).toBeGreaterThan(clip.start);
  });

  it('puts the end back when the trim is refused, and says why', async () => {
    const { end, edits } = mount();
    const refusal = { code: 'timeline.media_too_short', message: 'no' } as unknown as TaalcutError;
    vi.mocked(edits.trim).mockResolvedValueOnce(err(refusal));
    pointer(end, 'pointerdown', { x: 60, held: 1 });
    pointer(end, 'pointermove', { x: 70, held: 1 });
    pointer(end, 'pointerup', { x: 70 });
    await settle();
    expect(end.style.left).toBe('20%');
    expect(screen.getByRole('alert').textContent).toBe(
      'There isn’t enough footage for that: this clip, or the one next to it, runs out. Move the end by less.',
    );
    expect(edits.clearError).toHaveBeenCalled();
  });
});
