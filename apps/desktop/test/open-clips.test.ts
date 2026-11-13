// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2 round 4: main keeps the list of clips the windows show, for the jobs process's media cache. It is written empty
 * at start, then whole on every change: a page that opens a clip, goes elsewhere, crashes or reloads, and a window
 * that closes. A write that failed is made again at the next change.
 */
import { newId, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { clipOf, createOpenClips } from '../src/main/open-clips';
import { fakeClipWindow } from './helpers/clip-window';

describe('which clip a page shows', () => {
  it('reads the clip page’s path, and nothing else', () => {
    const clip = newId<'Asset'>();
    expect(clipOf(`app://taalcut/library/${clip}`)).toBe(clip);
    expect(clipOf(`http://localhost:5173/library/${clip}/`)).toBe(clip);
    expect(clipOf(`app://taalcut/library/${clip}?shot=2`)).toBe(clip);
    for (const page of [
      '/library',
      '/library/phone',
      '/library/phone/cable',
      `/library/${clip}/more`,
      '/projects',
    ])
      expect(clipOf(`app://taalcut${page}`)).toBeUndefined();
    expect(clipOf('not a url')).toBeUndefined();
  });
});

describe('the clips the windows show', () => {
  function track(fail: () => boolean = () => false) {
    const saved: AssetId[][] = [];
    const clips = createOpenClips((assetIds) => {
      if (fail()) return false;
      saved.push([...assetIds]);
      return true;
    });
    return { clips, saved };
  }

  it('is written empty at start, then whole on every change', () => {
    const [a, b] = [newId<'Asset'>(), newId<'Asset'>()].sort() as [AssetId, AssetId];
    const { clips, saved } = track();
    expect(saved).toEqual([[]]);
    const first = fakeClipWindow();
    clips.watch(first);
    expect(saved).toEqual([[]]);

    first.go(`/library/${b}`);
    const second = fakeClipWindow(`/library/${b}`);
    clips.watch(second); // the same clip: nothing new to write
    expect(saved).toEqual([[], [b]]);
    second.go(`/library/${a}`);
    expect(clips.current()).toEqual([a, b]);
    first.go('/library');
    second.crash();
    expect(saved).toEqual([[], [b], [a, b], [a], []]);
    second.load(`/library/${a}`); // reloaded after the crash
    second.close();
    expect(saved).toEqual([[], [b], [a, b], [a], [], [a], []]);
  });

  it('writes again at the next change when a write failed', () => {
    const clip = newId<'Asset'>();
    let failing = true;
    const { clips, saved } = track(() => failing);
    const win = fakeClipWindow();
    clips.watch(win);
    win.go(`/library/${clip}`);
    expect(saved).toEqual([]);
    failing = false;
    win.go(`/library/${clip}?shot=1`); // the same clip, so only because the last write failed
    expect(saved).toEqual([[clip]]);
    win.go(`/library/${clip}?shot=2`);
    expect(saved).toEqual([[clip]]);
  });
});
