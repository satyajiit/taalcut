// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError, err, type Timeline } from '@taalcut/core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LEAVE_MS, REST_MS } from '../src/features/timeline/other-shots/use-other-shots';
import { SceneStrip } from '../src/features/timeline/scene-strip';
import { castFixture, fakeLookup, nameOf, pointer, ShotsHarness } from './other-shots-support';
import { mountEditorControl } from './simple-editor-support';

const Refused = defineError('test.other_shots_refused');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const panel = () => screen.queryByRole('dialog');
/** The panel, by the name a screen reader gives it. */
const panelNamed = (name: string) => screen.queryByRole('dialog', { name });
const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
const selected = () => options().map((option) => option.getAttribute('aria-selected') === 'true');
const scene = (n: number) => document.querySelectorAll<HTMLElement>('[data-scene-clip]')[n - 1]!;
const sceneButton = (n: number) => scene(n).querySelector('button')!;
const describedBy = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

function mount(change: { timeline?: (timeline: Timeline) => Timeline; paused?: boolean } = {}) {
  const f = castFixture();
  const timeline = change.timeline ? change.timeline(f.timeline) : f.timeline;
  const pick = vi.fn();
  mountEditorControl(
    <ShotsHarness timeline={timeline} edits={f.edits} lookup={fakeLookup()} paused={change.paused ?? false}>
      {(model) => (
        <SceneStrip model={model} selectedIds={[]} onPick={pick} pictureFor={() => null} onEdit={vi.fn()} />
      )}
    </ShotsHarness>,
  );
  return { ...f, timeline, pick };
}

/** The pointer comes to rest on scene `n` and stays there. */
async function rest(n: number) {
  pointer(sceneButton(n), 'pointermove', { x: 40 + n * 100 });
  await wait(REST_MS);
}

it('opens once the pointer has rested on a scene, with what plays first and the others best first', async () => {
  const f = mount();
  pointer(sceneButton(2), 'pointermove');
  await wait(REST_MS - 1);
  expect(panel()).toBeNull();
  await wait(1);
  expect(panelNamed('Other shots for scene 2')).not.toBeNull();
  expect(screen.getByRole('listbox', { name: 'Other shots for scene 2' })).toBeTruthy();
  const cast = f.model.clips[1]!.cast!;
  const best = [...cast.alternates].sort((a, b) => b.score - a.score);
  expect(options().map((option) => option.title)).toEqual([cast.pick!, ...best].map(nameOf));
  expect(selected()).toEqual([true, false, false, false]);
  expect(options()[0]!.textContent).toContain('In use');
  expect(
    within(screen.getByRole('listbox')).getByRole('option', {
      name: new RegExp(`^Swap in this shot: ${nameOf(best[0]!)}`),
    }),
  ).toBe(options()[1]);
  // The pointer opened it: focus is where it was.
  expect(panel()!.contains(document.activeElement)).toBe(false);
});

it('waits for the pointer to stop: moving on starts the wait again', async () => {
  mount();
  pointer(sceneButton(2), 'pointermove', { x: 100 });
  await wait(REST_MS - 50);
  pointer(sceneButton(2), 'pointermove', { x: 130 });
  await wait(REST_MS - 50);
  expect(panel()).toBeNull();
  // A hand that only trembles is at rest.
  pointer(sceneButton(2), 'pointermove', { x: 132 });
  await wait(50);
  expect(panel()).not.toBeNull();
});

it('stays shut while a button is held, and after a press until the pointer has left the scene', async () => {
  const f = mount();
  pointer(sceneButton(2), 'pointermove', { held: 1 });
  await wait(REST_MS * 2);
  expect(panel()).toBeNull();
  // The press that selects a scene is the scene's own.
  pointer(sceneButton(2), 'pointerdown', { held: 1 });
  fireEvent.click(sceneButton(2));
  expect(f.pick).toHaveBeenCalledWith(f.model.clips[1]!.item.id, false, false);
  pointer(sceneButton(2), 'pointermove', { x: 60 });
  await wait(REST_MS * 2);
  expect(panel()).toBeNull();
  pointer(sceneButton(3), 'pointermove');
  pointer(sceneButton(2), 'pointermove', { x: 60 });
  await wait(REST_MS);
  expect(panelNamed('Other shots for scene 2')).not.toBeNull();
});

it('a press outside closes it at once and the press still lands', async () => {
  const f = mount();
  await rest(2);
  await wait(1);
  fireEvent.pointerDown(sceneButton(2));
  fireEvent.click(sceneButton(2));
  await wait(0);
  expect(panel()).toBeNull();
  expect(f.pick).toHaveBeenCalledTimes(1);
});

it('swaps on a press with the cast board’s command and stays open on the new state', async () => {
  const f = mount();
  await rest(3);
  const clip = f.model.clips[2]!;
  const before = options().map((option) => option.title);
  const chosen = [...clip.cast!.alternates].sort((a, b) => b.score - a.score)[1]!;
  fireEvent.click(options()[2]!);
  await wait(0);
  expect(f.edits.swap).toHaveBeenCalledExactlyOnceWith(clip.item.id, chosen, 'alternate');
  expect(panel()).not.toBeNull();
  // The frames stay where they were; the mark moved to the one pressed.
  expect(options().map((option) => option.title)).toEqual(before);
  expect(selected()).toEqual([false, false, true, false]);
  expect(screen.getByRole('status').textContent).toBe(`Swapped in ${nameOf(chosen)}.`);
  // And back: the old pick is one of the others now.
  fireEvent.click(options()[0]!);
  await wait(0);
  expect(f.edits.swap).toHaveBeenLastCalledWith(clip.item.id, clip.cast!.pick, 'alternate');
  expect(selected()).toEqual([true, false, false, false]);
});

it('pressing what is in use does nothing, and a refused swap says why', async () => {
  const f = mount();
  vi.mocked(f.edits.swap).mockResolvedValueOnce(err(Refused()));
  await rest(1);
  fireEvent.click(options()[0]!);
  await wait(0);
  expect(f.edits.swap).not.toHaveBeenCalled();
  fireEvent.click(options()[1]!);
  await wait(0);
  expect(f.edits.swap).toHaveBeenCalledTimes(1);
  expect(within(panel()!).getByRole('alert').textContent).not.toBe('');
  expect(selected()).toEqual([true, false, false, false]);
  expect(screen.getByRole('status').textContent).toBe('');
});

it('opens from the keyboard with ↑, moves with the arrows, swaps with Return and goes back with Escape', async () => {
  const f = mount();
  const button = sceneButton(2);
  expect(button.getAttribute('aria-keyshortcuts')).toBe('ArrowUp');
  expect(describedBy(button)).toBe('Up arrow shows other shots.');
  button.focus();
  fireEvent.keyDown(button, { key: 'ArrowUp' });
  await wait(0);
  expect(panelNamed('Other shots for scene 2')).not.toBeNull();
  expect(document.activeElement).toBe(options()[1]);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(options()[2]);
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(options()[3]);
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(options()[0]);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  // Return on a button is its click.
  fireEvent.click(document.activeElement!);
  await wait(0);
  const clip = f.model.clips[1]!;
  const best = [...clip.cast!.alternates].sort((a, b) => b.score - a.score)[0]!;
  expect(f.edits.swap).toHaveBeenCalledExactlyOnceWith(clip.item.id, best, 'alternate');
  expect(document.activeElement).toBe(options()[1]);
  // The pointer passing by does not close what the keyboard opened.
  pointer(scene(4), 'pointerout', { to: document.body });
  await wait(LEAVE_MS * 2);
  expect(panel()).not.toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await wait(0);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(button);
});

it('↓ and Tab go back to the scene too', async () => {
  mount();
  for (const key of ['ArrowDown', 'Tab']) {
    const button = sceneButton(1);
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    await wait(0);
    expect(document.activeElement).toBe(options()[1]);
    fireEvent.keyDown(document.activeElement!, { key });
    await wait(0);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button);
  }
});

it('closes soon after the pointer leaves, unless it went to the panel', async () => {
  mount();
  await rest(2);
  pointer(scene(2), 'pointerout', { to: document.body });
  await wait(LEAVE_MS - 1);
  expect(panel()).not.toBeNull();
  pointer(panel()!, 'pointerover');
  await wait(LEAVE_MS * 3);
  expect(panel()).not.toBeNull();
  pointer(panel()!, 'pointerout', { to: document.body });
  await wait(LEAVE_MS);
  expect(panel()).toBeNull();
});

it('closes when the timeline scrolls', async () => {
  mount();
  await rest(2);
  expect(panel()).not.toBeNull();
  fireEvent.scroll(document.querySelector('[data-slot=scene-strip]')!);
  await wait(0);
  expect(panel()).toBeNull();
});

it('a timeline without a cast behaves as before: no panel, no key, nothing said', async () => {
  mount({ timeline: (timeline) => ({ ...timeline, cast: null }) });
  await rest(2);
  expect(panel()).toBeNull();
  const button = sceneButton(2);
  expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
  expect(button.hasAttribute('aria-describedby')).toBe(false);
  button.focus();
  // The key is left for whoever else wants it.
  expect(fireEvent.keyDown(button, { key: 'ArrowUp' })).toBe(true);
  await wait(REST_MS);
  expect(panel()).toBeNull();
});

it('a scene whose cast kept nothing else shows nothing, while its neighbours still do', async () => {
  mount({
    timeline: (timeline) => ({
      ...timeline,
      cast: timeline.cast && {
        ...timeline.cast,
        slots: timeline.cast.slots.map((slot, index) => (index === 1 ? { ...slot, alternates: [] } : slot)),
      },
    }),
  });
  await rest(2);
  expect(panel()).toBeNull();
  expect(sceneButton(2).hasAttribute('aria-keyshortcuts')).toBe(false);
  await rest(3);
  expect(panelNamed('Other shots for scene 3')).not.toBeNull();
});

it('offers nothing while the AI holds the timeline, and says why a locked scene can’t be swapped', async () => {
  const f = castFixture();
  const locked: Timeline = {
    ...f.timeline,
    tracks: f.timeline.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item, index) =>
              item.type === 'clip' && index === 0 ? { ...item, locked: true } : item,
            ),
          },
    ),
  };
  const strip = (paused: boolean) => (
    <ShotsHarness timeline={locked} edits={f.edits} lookup={fakeLookup()} paused={paused}>
      {(model) => (
        <SceneStrip
          model={model}
          selectedIds={[]}
          onPick={vi.fn()}
          pictureFor={() => null}
          onEdit={vi.fn()}
        />
      )}
    </ShotsHarness>
  );
  const view = mountEditorControl(strip(false));
  await rest(1);
  expect(describedBy(screen.getByRole('listbox'))).toMatch(/^Locked: /);
  expect(options()[1]!.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(options()[1]!);
  await wait(0);
  expect(f.edits.swap).not.toHaveBeenCalled();
  // The AI starts editing: the panel goes and none opens.
  view.rerender(strip(true));
  await wait(0);
  expect(panel()).toBeNull();
  pointer(sceneButton(3), 'pointermove', { x: 300 });
  await wait(REST_MS);
  expect(panel()).toBeNull();
});
