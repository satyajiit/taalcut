// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { NEUTRAL_GRADE, RationalTime, type Clip, type Timeline } from '@taalcut/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreGallery } from '../src/features/timeline/more/more-gallery';
import { MoreTile } from '../src/features/timeline/more/more-tile';
import { moreFixture, mountGallery, tile, tileValue } from './more-support';

const SCENE_TILES = ['speed', 'transition', 'freeze', 'colour', 'why'];

describe('the More gallery', () => {
  it('shows the scene and the video as two groups of tiles, each saying its value in words', () => {
    const f = moreFixture();
    mountGallery(f);
    const scene = screen.getByRole('region', { name: /^Scene 3/ });
    const video = screen.getByRole('region', { name: 'This video' });
    expect(
      within(scene)
        .getAllByRole('button')
        .filter((b) => b.dataset.slot === 'more-tile'),
    ).toHaveLength(5);
    expect(
      within(video)
        .getAllByRole('button')
        .filter((b) => b.dataset.slot === 'more-tile'),
    ).toHaveLength(2);
    expect(tileValue('speed')).toBe('Normal speed');
    expect(tileValue('transition')).toBe('A plain cut');
    expect(tileValue('freeze')).toBe('Hold one moment');
    expect(tileValue('colour')).toBe('As shot');
    expect(tileValue('why')).toBe('Taalcut picked this');
    expect(tileValue('cover')).toBe('None chosen yet');
    expect(tileValue('size')).toBe('This video is 9:16');
    // A tile's name to a screen reader is its two lines, as written.
    expect(tile('speed').textContent).toBe('SpeedNormal speed');
    for (const name of [...SCENE_TILES, 'cover', 'size'])
      expect(tile(name).getAttribute('aria-disabled')).toBeNull();
    // The scene's own line: when it starts and how long it lasts.
    expect(document.querySelector('[data-slot=more-scene-line]')?.getAttribute('data-state')).toBe('ready');
  });

  it('says each value the scene has now: its speed, its transition, its colour, a held moment', () => {
    const rate = { num: 30, den: 1 };
    const f = moreFixture({
      patch: (clip): Clip => ({
        ...clip,
        speed: {
          curve: 'hold',
          points: [
            { at: RationalTime.of(0, rate), speed: 2 },
            { at: RationalTime.of(30, rate), speed: 2 },
          ],
        },
        grade: { ...NEUTRAL_GRADE, look: 'warm', exposure: 0.2, saturation: -0.6, contrast: 0.2 },
      }),
      timeline: (timeline): Timeline => ({
        ...timeline,
        covers: [{ aspect: '9:16', source: { kind: 'frame', frame: 80 } }] as Timeline['covers'],
      }),
    });
    mountGallery(f);
    expect(tileValue('speed')).toBe('2× speed');
    expect(tileValue('colour')).toBe('Warm · A little brighter · Less colour · Fine-tuned');
    // The Colour chip is the scene's own frame under its grade once it has one.
    expect(tile('colour').querySelector('[data-slot=grade-picture]')).not.toBeNull();
    expect(tileValue('cover')).toBe('1 cover saved');
    expect(tile('cover').querySelector('[data-slot=more-cover]')).not.toBeNull();
  });

  it('names a held moment and its length, and offers it no speed', () => {
    const f = moreFixture({
      patch: (clip): Clip => ({ ...clip, holdFrame: RationalTime.of(19, { num: 30, den: 1 }) }),
    });
    mountGallery(f);
    expect(tile('freeze').textContent).toBe('Held momentFor 1 second');
    expect(tileValue('speed')).toBe('A hold has none');
    expect(tile('speed').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(tile('speed'));
    expect(document.querySelector('[data-slot=more-sheet]')).toBeNull();
  });

  it('explains itself with no scene selected: quiet scene tiles, a way to pick one, the video still at hand', () => {
    const f = moreFixture({ scene: null });
    mountGallery(f);
    expect(screen.getByRole('heading', { name: 'This scene' })).toBeTruthy();
    const line = document.querySelector('[data-slot=more-scene-line]')!;
    expect(line.textContent).toBe('Pick a scene to change its speed, transition and colour.');
    for (const name of SCENE_TILES) {
      expect(tile(name).getAttribute('aria-disabled')).toBe('true');
      // Each waiting tile names the line that says why.
      expect(tile(name).getAttribute('aria-describedby')).toBe(line.id);
      fireEvent.click(tile(name));
    }
    expect(tileValue('speed')).toBe('Slower or faster');
    expect(tileValue('why')).toBe('Who picked it, and what was asked for');
    expect(document.querySelector('[data-slot=more-sheet]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to scenes' }));
    expect(f.props.onScenes).toHaveBeenCalledTimes(1);
    fireEvent.click(tile('cover'));
    expect(f.props.onCover).toHaveBeenCalledTimes(1);
    expect(tile('size').getAttribute('aria-disabled')).toBeNull();
  });

  it('points at the timeline instead where the timeline is on screen', () => {
    const f = moreFixture({ scene: null });
    mountGallery(f, { onScenes: undefined });
    expect(document.querySelector('[data-slot=more-scene-line]')?.textContent).toBe(
      'Select a scene on the timeline to change its speed, transition and colour.',
    );
    expect(screen.queryByRole('button', { name: 'Back to scenes' })).toBeNull();
  });

  it('keeps a locked scene readable: the reason in words, its values, and Why this shot still open', () => {
    const f = moreFixture({ patch: (clip): Clip => ({ ...clip, locked: true }) });
    mountGallery(f);
    const line = document.querySelector('[data-slot=more-scene-line]')!;
    expect(line.textContent).toBe('Locked. Unlock it to change it.');
    expect(screen.getByRole('button', { name: 'Unlock' }).getAttribute('aria-pressed')).toBe('true');
    for (const name of ['speed', 'transition', 'freeze', 'colour']) {
      expect(tile(name).getAttribute('aria-disabled')).toBe('true');
      expect(tile(name).getAttribute('aria-describedby')).toBe(line.id);
      fireEvent.click(tile(name));
    }
    expect(tileValue('speed')).toBe('Normal speed');
    expect(document.querySelector('[data-slot=more-sheet]')).toBeNull();
    expect(f.command).not.toHaveBeenCalled();
    fireEvent.click(tile('why'));
    expect(screen.getByRole('dialog', { name: 'Why this shot' })).toBeTruthy();
  });

  it('waits while the AI edits: the scene tiles and the size copy say so, the cover still opens', () => {
    const f = moreFixture({ edits: { pending: true, aiPaused: true } });
    mountGallery(f);
    expect(document.querySelector('[data-slot=more-scene-line]')?.textContent).toBe(
      'These wait while Taalcut edits this video.',
    );
    for (const name of ['speed', 'transition', 'freeze', 'colour', 'size']) {
      expect(tile(name).getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(tile(name));
    }
    expect(tileValue('size')).toBe('Waits while Taalcut edits');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(tile('cover'));
    expect(f.props.onCover).toHaveBeenCalledTimes(1);
    expect(f.command).not.toHaveBeenCalled();
  });

  it('says why a photo has no speed and no moment to freeze, and still offers its transition and colour', () => {
    const f = moreFixture({
      patch: (clip): Clip => ({ ...clip, media: { kind: 'image', assetId: clip.media.assetId } }),
    });
    mountGallery(f);
    expect(tileValue('speed')).toBe('A photo has none');
    expect(tileValue('freeze')).toBe('Already still');
    expect(tile('speed').getAttribute('aria-disabled')).toBe('true');
    expect(tile('freeze').getAttribute('aria-disabled')).toBe('true');
    expect(tile('transition').getAttribute('aria-disabled')).toBeNull();
    expect(tile('colour').getAttribute('aria-disabled')).toBeNull();
  });

  it('says the last scene has no next one to cut into', () => {
    const f = moreFixture({ scene: 11 });
    mountGallery(f);
    expect(tileValue('transition')).toBe('No next scene');
    expect(tile('transition').getAttribute('aria-disabled')).toBe('true');
    expect(tile('speed').getAttribute('aria-disabled')).toBeNull();
  });

  it('opens a sheet in the tiles’ place and gives focus back to its tile on Back and on Escape', () => {
    const f = moreFixture();
    // The editor listens for Escape on the window, above the panel.
    const onKeyDown = vi.fn();
    document.addEventListener('keydown', onKeyDown);
    mountGallery(f);
    fireEvent.click(tile('speed'));
    const sheet = document.querySelector<HTMLElement>('[data-slot=more-sheet][data-sheet=speed]')!;
    expect(sheet).not.toBeNull();
    // It rises into place (under reduced motion it only fades: more-reduced-motion.test.tsx).
    expect(sheet.querySelector<HTMLElement>(':scope > div')?.style.transform).toContain('translateY');
    // The tiles stay mounted behind it (hidden), so the tile is there to take focus back.
    expect(document.querySelector<HTMLElement>('[data-slot=more-gallery]')!.hidden).toBe(true);
    // Focus starts on the speed in use.
    expect(document.activeElement?.getAttribute('data-value')).toBe('1');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back' }));
    expect(document.querySelector('[data-slot=more-sheet]')).toBeNull();
    expect(document.activeElement).toBe(tile('speed'));

    fireEvent.click(tile('colour'));
    const colour = document.querySelector<HTMLElement>('[data-slot=more-sheet][data-sheet=colour]')!;
    // Escape is the sheet's: the editor's own Escape (which lets go of the scene) never sees it.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(colour, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot=more-sheet]')).toBeNull();
    expect(document.activeElement).toBe(tile('colour'));
    document.removeEventListener('keydown', onKeyDown);
  });

  it('keeps an open sheet on the scene that is selected, and closes it for a scene without that choice', () => {
    const f = moreFixture();
    const view = mountGallery(f);
    fireEvent.click(tile('transition'));
    expect(screen.getByText('How scene 3 goes into scene 4.')).toBeTruthy();
    const next = f.model.clips[4]!;
    view.rerender(<MoreGallery {...f.props} selection={{ kind: 'clip', clipId: next.item.id }} />);
    expect(screen.getByText('How scene 5 goes into scene 6.')).toBeTruthy();
    const last = f.model.clips[11]!;
    view.rerender(<MoreGallery {...f.props} selection={{ kind: 'clip', clipId: last.item.id }} />);
    expect(document.querySelector('[data-slot=more-sheet]')).toBeNull();
    expect(tileValue('transition')).toBe('No next scene');
  });

  it('shows the video’s tiles alone for a designed video with nothing selected', () => {
    const f = moreFixture({ scene: null });
    mountGallery(f, { videoOnly: true });
    expect(screen.queryByRole('heading', { name: 'This scene' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Video actions' })).toBeTruthy();
    expect(tileValue('size')).toBe('This video is 9:16');
  });

  it('takes one more video tile after Cover, in the same column', () => {
    const f = moreFixture();
    const onOpen = vi.fn();
    mountGallery(f, {
      videoTiles: (
        <MoreTile id="caption" family="video" name="Caption" value="None yet" dialog onOpen={onOpen} />
      ),
    });
    const column = document.querySelector('[data-slot=more-video-tiles]');
    const order = [...(column?.children ?? [])].map((node) => node.getAttribute('data-tile'));
    expect(order).toEqual(['cover', 'caption', 'size']);
    fireEvent.click(tile('caption'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
