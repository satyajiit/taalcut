// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2: what the clip page's viewer can do and why not, from the library's detail: play its copy (or the original
// that is its own copy), or say the copy is being made, couldn't be made, is gone, or didn't load; the shape it
// plays at; one frame's length; the sound lane's envelope; a shot kind's colour family.
import type { AssetDetail, DerivedFileRef } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { frameMsOf, frameRatio, viewerState } from '../src/features/library/clip/player/viewer-state';
import { SHOT_FAMILY, shotMark } from '../src/features/library/clip/scrubber/shot-kinds';
import { waveformPath } from '../src/features/library/clip/scrubber/scrub-lanes';

const RATE = { num: 30, den: 1 };
const proxy: DerivedFileRef = {
  kind: 'proxy',
  key: `proxies/cd/${'cd'.repeat(32)}.v1.mp4`,
  bytes: 812_000,
  mimeType: 'video/mp4',
  width: 540,
  height: 960,
  duration: { value: 183, rate: RATE },
  frameRate: RATE,
  recipe: 1,
};
const withProxyStage = (state: AssetDetail['stages'][number]['state'], patch: Partial<AssetDetail> = {}) => ({
  ...CLIP_FIXTURE,
  stages: [...CLIP_FIXTURE.stages, { stage: 'media.proxy', state }],
  ...patch,
});

describe('the clip viewer', () => {
  it('plays the copy, and says when it didn’t load', () => {
    const detail = withProxyStage('done', { playback: { source: 'proxy', file: proxy } });
    expect(viewerState(detail, false)).toEqual({ kind: 'playable' });
    expect(viewerState(detail, true)).toEqual({ kind: 'broken', source: 'proxy' });
  });

  it('says why there is nothing to play: being made, couldn’t be made, let go and made again, or the original away', () => {
    expect(viewerState(withProxyStage('running'), false)).toEqual({ kind: 'preparing' });
    expect(viewerState(withProxyStage('queued'), false)).toEqual({ kind: 'preparing' });
    const error = { code: 'media.encode_failed', messageKey: 'errors.media.encode_failed', retryable: true };
    expect(
      viewerState({ ...CLIP_FIXTURE, stages: [{ stage: 'media.proxy', state: 'failed', error }] }, false),
    ).toEqual({ kind: 'proxyFailed', error });
    // Done without a copy: the media cache let it go, and opening the clip makes it again (round 2).
    expect(viewerState(withProxyStage('done'), false)).toEqual({ kind: 'again' });
    expect(viewerState(withProxyStage('skipped'), false)).toEqual({ kind: 'noCopy' });
    const away = withProxyStage('waiting', {
      locations: CLIP_FIXTURE.locations.map((location) => ({ ...location, state: 'offline' as const })),
    });
    expect(viewerState(away, false)).toEqual({ kind: 'originalAway' });
    expect(viewerState({ ...CLIP_FIXTURE, asset: { ...CLIP_FIXTURE.asset, kind: 'image' } }, false)).toEqual({
      kind: 'photo',
    });
  });

  it('plays at the clip’s upright shape, and an original that is its own copy at its own', () => {
    expect(frameRatio(CLIP_FIXTURE)).toBeCloseTo(9 / 16);
    const own: AssetDetail = {
      ...CLIP_FIXTURE,
      playback: {
        source: 'original',
        width: 720,
        height: 1280,
        duration: { value: 150, rate: RATE },
        frameRate: { num: 25, den: 1 },
      },
    };
    expect(frameRatio(own)).toBeCloseTo(720 / 1280);
    expect(frameMsOf(own)).toBe(40);
    expect(frameMsOf(CLIP_FIXTURE)).toBeCloseTo(1000 / 30);
    expect(frameMsOf({ ...CLIP_FIXTURE, facts: null })).toBeCloseTo(1000 / 30);
  });

  it('draws the sound as a mirrored envelope, never flat to nothing', () => {
    expect(waveformPath([])).toBe('');
    expect(waveformPath([1, 0])).toBe('M0,0.0L1,49.0L1,51.0L0,100.0Z');
  });

  it('colours each shot kind by how far the camera is, and an unknown one neutral', () => {
    expect(SHOT_FAMILY.wide).toBe('far');
    expect(SHOT_FAMILY.aerial).toBe('far');
    expect(SHOT_FAMILY.close).toBe('near');
    expect(SHOT_FAMILY.screen).toBe('graphic');
    expect(shotMark('detail')).toBe('bg-rose-strong');
    expect(shotMark(null)).toBe('bg-rule-strong');
  });
});
