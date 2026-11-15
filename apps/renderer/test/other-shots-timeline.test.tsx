// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { REST_MS } from '../src/features/timeline/other-shots/use-other-shots';
import { SceneStrip } from '../src/features/timeline/scene-strip';
import { VideoTrack } from '../src/features/timeline/video-track';
import {
  castFixture,
  fakeLookup,
  filmstripFixture,
  LoadedImage,
  pointer,
  ShotsHarness,
} from './other-shots-support';
import { mountEditorControl } from './simple-editor-support';

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no pointer capture and no Web Animations; the clips take one when a press starts and settle with
  // the other when a drag ends.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.animate = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const panel = () => screen.queryByRole('dialog');
// The detailed timeline's clips are options of their own list: these are the panel's.
const options = () => within(screen.getByRole('dialog')).getAllByRole('option');
const clipBlock = (n: number) => document.querySelectorAll<HTMLElement>('[data-slot=timeline-clip]')[n - 1]!;

function mountTrack() {
  const f = castFixture();
  const select = vi.fn();
  const pick = vi.fn();
  mountEditorControl(
    <ShotsHarness timeline={f.timeline} edits={f.edits} lookup={fakeLookup()}>
      {(model, edits) => (
        <VideoTrack
          model={model}
          pxPerFrame={2}
          selectedClipId={null}
          onPick={pick}
          onSelect={select}
          pictureFor={() => null}
          edits={edits}
          onOpenInspector={vi.fn()}
        />
      )}
    </ShotsHarness>,
  );
  return { ...f, select, pick };
}

it('shows a clip’s other shots on the detailed timeline too, named for the clip', async () => {
  mountTrack();
  expect(clipBlock(2).getAttribute('aria-keyshortcuts')).toBe('ArrowUp');
  pointer(clipBlock(2), 'pointermove', { x: 200 });
  await wait(REST_MS);
  expect(screen.queryByRole('dialog', { name: 'Other shots for clip 2' })).not.toBeNull();
  expect(options()).toHaveLength(4);
});

it('never opens under a drag or a trim, nor on the clip just let go of', async () => {
  const f = mountTrack();
  const clip = clipBlock(2);
  pointer(clip, 'pointermove', { x: 200 });
  await wait(REST_MS - 100);
  // The press that starts a drag cancels the wait and selects the clip.
  pointer(clip, 'pointerdown', { x: 200, held: 1 });
  expect(f.pick).toHaveBeenCalledWith(f.model.clips[1]!.item.id, false, false);
  await wait(REST_MS);
  expect(panel()).toBeNull();
  pointer(clip, 'pointermove', { x: 260, held: 1 });
  await wait(REST_MS * 2);
  expect(panel()).toBeNull();
  // A trim: the pointer is held on the clip's edge.
  pointer(clip.querySelector('[data-slot=trim-handle]')!, 'pointermove', { x: 300, held: 1 });
  await wait(REST_MS * 2);
  expect(panel()).toBeNull();
  pointer(clip, 'pointerup', { x: 260 });
  pointer(clip, 'pointermove', { x: 262 });
  await wait(REST_MS * 2);
  expect(panel()).toBeNull();
});

it('closes for a press that starts a drag while it is open', async () => {
  mountTrack();
  pointer(clipBlock(3), 'pointermove', { x: 400 });
  await wait(REST_MS);
  expect(panel()).not.toBeNull();
  await wait(1);
  fireEvent.pointerDown(clipBlock(3));
  await wait(0);
  expect(panel()).toBeNull();
});

it('↑ on the focused clip opens it, and the Escape that closes it is not also the clip’s', async () => {
  const f = mountTrack();
  const clip = clipBlock(1);
  clip.focus();
  fireEvent.keyDown(clip, { key: 'ArrowUp' });
  await wait(0);
  expect(screen.queryByRole('dialog', { name: 'Other shots for clip 1' })).not.toBeNull();
  expect(document.activeElement).toBe(options()[1]);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await wait(0);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(clip);
  expect(f.select).not.toHaveBeenCalledWith(null);
  // Opened by the pointer with the clip focused: Escape closes the panel; the next one lets go of the clip.
  pointer(clip, 'pointermove', { x: 20 });
  await wait(REST_MS);
  expect(panel()).not.toBeNull();
  fireEvent.keyDown(clip, { key: 'Escape' });
  await wait(0);
  expect(panel()).toBeNull();
  expect(f.select).not.toHaveBeenCalledWith(null);
  fireEvent.keyDown(clip, { key: 'Escape' });
  expect(f.select).toHaveBeenCalledWith(null);
});

it('draws each shot at the moment it would start from, and plays its stretch under the pointer', async () => {
  vi.stubGlobal('Image', LoadedImage);
  const f = filmstripFixture();
  mountEditorControl(
    <ShotsHarness timeline={f.timeline} edits={f.edits} lookup={f.lookup}>
      {(model) => (
        <SceneStrip
          model={model}
          selectedIds={[]}
          onPick={vi.fn()}
          pictureFor={() => null}
          onEdit={vi.fn()}
        />
      )}
    </ShotsHarness>,
  );
  pointer(document.querySelector('[data-scene-clip] button')!, 'pointermove');
  await wait(REST_MS);
  const option = options()[1]!;
  const frame = () => option.querySelector('[data-frame]');
  expect(frame()?.getAttribute('data-frame')).toBe('4');
  expect(frame()?.hasAttribute('data-playing')).toBe(false);
  // Four frames in the stretch (seconds 4 to 7), 750 ms each: the clip's own three seconds, over and over.
  pointer(option, 'pointerover');
  await wait(0);
  expect(frame()?.hasAttribute('data-playing')).toBe(true);
  const seen: string[] = [];
  for (let turn = 0; turn < 5; turn += 1) {
    seen.push(frame()!.getAttribute('data-frame')!);
    await wait(750);
  }
  expect(seen).toEqual(['4', '5', '6', '7', '4']);
  pointer(option, 'pointerout', { to: document.body });
  await wait(0);
  expect(frame()?.getAttribute('data-frame')).toBe('4');
  expect(frame()?.hasAttribute('data-playing')).toBe(false);
  // A file without a filmstrip keeps its shot's own picture: nothing to play.
  expect(options()[2]!.querySelector('[data-frame]')).toBeNull();
});
