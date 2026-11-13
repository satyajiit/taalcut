// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2, round 2: the scrubber's filmstrip draws only from the sprite media.filmstrip made at import. Until there is
// one it says where that stage really is (being made, next, after the copy to play, failed with the cause, not
// needed, let go and made again); the hover plate shows the sprite frame nearest the pointer, or the time alone.
import { I18nProvider } from '@lingui/react';
import type { AssetDetail, Filmstrip } from '@taalcut/core';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { ClipFilmstrip } from '../src/features/library/clip/scrubber/clip-filmstrip';
import { filmstripState, type FilmstripState } from '../src/features/library/clip/scrubber/filmstrip-state';
import { ScrubHover } from '../src/features/library/clip/scrubber/scrub-hover';
import { frameStyle, nearestFrame } from '../src/features/library/clip/scrubber/sprite';
import { letGo } from '../src/features/library/clip/use-clip-detail';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { createTestServices } from '../src/services/create';
import { ServicesProvider } from '../src/services/provider';

beforeAll(() => activateLocale('en'));

const RATE = { num: 30, den: 1 };
const HASH = 'ab'.repeat(32);
/** Six frames a second apart, on a 3 × 2 grid of 108 × 192 tiles; the fake serves the portrait sample's sprite. */
const STRIP: Filmstrip = {
  file: {
    kind: 'filmstrip',
    key: `filmstrips/ab/${HASH}.sample-portrait-strip.v2.jpg`,
    bytes: 40_000,
    mimeType: 'image/jpeg',
    width: 324,
    height: 384,
    recipe: 2,
  },
  columns: 3,
  rows: 2,
  tileWidth: 108,
  tileHeight: 192,
  times: [0, 30, 60, 90, 120, 150].map((value) => ({ value, rate: RATE })),
};

type Row = AssetDetail['stages'][number];
const withRows = (rows: Row[], patch: Partial<AssetDetail> = {}): AssetDetail => ({
  ...CLIP_FIXTURE,
  stages: rows,
  ...patch,
});
const proxy = (state: Row['state']): Row => ({ stage: 'media.proxy', state });
const strip = (state: Row['state'], extra: Partial<Row> = {}): Row => ({
  stage: 'media.filmstrip',
  state,
  ...extra,
});

/** An Image that loads (or doesn't) on the next tick, as the browser would; jsdom loads none. */
function stubImages(outcome: 'load' | 'error') {
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()));
      }
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

function wrap(node: ReactNode) {
  return render(
    <I18nProvider i18n={i18n}>
      <ServicesProvider services={createTestServices()}>{node}</ServicesProvider>
    </I18nProvider>,
  );
}

const lineOf = (state: FilmstripState) => {
  const { container, unmount } = wrap(
    <ClipFilmstrip state={state} spans={[]} length={6000} ratio={9 / 16} />,
  );
  const text = container.querySelector('[data-slot="clip-filmstrip-state"]')?.textContent ?? null;
  unmount();
  return text;
};

describe('what the filmstrip shows', () => {
  it('is the sprite once made, else where media.filmstrip really is', () => {
    expect(filmstripState(withRows([proxy('done'), strip('done')], { filmstrip: STRIP }))).toEqual({
      kind: 'drawn',
      filmstrip: STRIP,
    });
    expect(filmstripState(withRows([proxy('done'), strip('running')]))).toEqual({ kind: 'making' });
    expect(filmstripState(withRows([proxy('done'), strip('queued')]))).toEqual({ kind: 'next' });
    const error = { code: 'media.decode_failed', messageKey: 'errors.media.decode_failed', retryable: false };
    expect(filmstripState(withRows([proxy('done'), strip('failed', { error })]))).toEqual({
      kind: 'failed',
      error,
    });
    expect(filmstripState(withRows([strip('skipped', { reasonKey: 'indexing.skip.noAudio' })]))).toEqual({
      kind: 'skipped',
      reasonKey: 'indexing.skip.noAudio',
    });
    // Done with no sprite: the media cache let it go; opening the clip makes it again.
    expect(filmstripState(withRows([proxy('done'), strip('done')]))).toEqual({ kind: 'again' });
    expect(filmstripState(withRows([proxy('running'), strip('waiting')]))).toEqual({ kind: 'afterCopy' });
    expect(filmstripState(withRows([proxy('failed'), strip('waiting')]))).toEqual({ kind: 'noCopy' });
    expect(filmstripState(withRows([proxy('done'), strip('waiting')]))).toEqual({ kind: 'waiting' });
    // A library that lists no such step for the clip makes none for it.
    expect(filmstripState(withRows([proxy('done')]))).toEqual({ kind: 'skipped' });
    expect(
      filmstripState(
        withRows([proxy('waiting'), strip('waiting', { reasonKey: 'library.stage.originalOffline' })]),
      ),
    ).toEqual({ kind: 'waiting', reasonKey: 'library.stage.originalOffline' });
  });

  it('asks for the clip’s files again when the cache let its copy or its filmstrip go', () => {
    const playback = {
      source: 'original' as const,
      width: 720,
      height: 1280,
      duration: { value: 180, rate: RATE },
      frameRate: RATE,
    };
    const both = { filmstrip: STRIP, playback };
    expect(letGo(withRows([proxy('done'), strip('done')], both))).toBe(false);
    expect(letGo(withRows([proxy('done'), strip('done')], { playback }))).toBe(true);
    expect(letGo(withRows([proxy('done'), strip('running')], { playback }))).toBe(false);
    expect(letGo(withRows([proxy('done'), strip('done')], { ...both, playback: null }))).toBe(true);
    expect(letGo(withRows([proxy('skipped')], { playback: null }))).toBe(false);
  });

  it('picks the frame nearest a moment, the earlier on a tie', () => {
    const times = [0, 1000, 2000];
    expect([-5, 400, 500, 600, 1999, 2500].map((at) => nearestFrame(times, at))).toEqual([0, 0, 0, 1, 2, 2]);
    expect(nearestFrame([0], 9000)).toBe(0);
  });

  it('shows one tile of the sprite covering a box, centred as object-fit: cover would', () => {
    expect(frameStyle(STRIP, '/s.jpg', 4, { width: 108, height: 192 })).toEqual({
      backgroundImage: 'url("/s.jpg")',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '324px 384px',
      backgroundPosition: '-108px -192px',
    });
    // A slot narrower than the clip: the tile scales to the width and its middle shows.
    expect(frameStyle(STRIP, '/s.jpg', 4, { width: 54, height: 56 })).toMatchObject({
      backgroundSize: '162px 192px',
      backgroundPosition: '-54px -116px',
    });
  });
});

describe('the scrubber’s filmstrip', () => {
  it('fades the sprite’s frames in once it has loaded', async () => {
    stubImages('load');
    const { container } = wrap(
      <ClipFilmstrip state={{ kind: 'drawn', filmstrip: STRIP }} spans={[]} length={6000} ratio={9 / 16} />,
    );
    const root = container.querySelector('[data-slot="clip-filmstrip"]');
    expect(root?.getAttribute('data-state')).toBe('drawn');
    const frames = root?.querySelector('div');
    expect(frames?.hasAttribute('data-ready')).toBe(false);
    await act(async () => {});
    expect(frames?.hasAttribute('data-ready')).toBe(true);
    expect(root?.querySelector('[data-frame]')?.getAttribute('style')).toContain(
      '/fake-media/portrait-strip.jpg',
    );
  });

  it('says so when the sprite didn’t load', async () => {
    stubImages('error');
    const { container } = wrap(
      <ClipFilmstrip state={{ kind: 'drawn', filmstrip: STRIP }} spans={[]} length={6000} ratio={9 / 16} />,
    );
    await act(async () => {});
    expect(container.querySelector('[data-slot="clip-filmstrip"]')?.getAttribute('data-state')).toBe(
      'broken',
    );
    expect(screen.getByText('This clip’s frames didn’t load.')).toBeTruthy();
  });

  it('says where the filmstrip is until it is made, in one line each', () => {
    const error = { code: 'media.decode_failed', messageKey: 'errors.media.decode_failed', retryable: false };
    expect(lineOf({ kind: 'making' })).toBe('Laying out this clip’s frames…');
    expect(lineOf({ kind: 'next' })).toBe('This clip’s frames are next.');
    expect(lineOf({ kind: 'afterCopy' })).toBe('The frames come once the copy to play is made.');
    expect(lineOf({ kind: 'noCopy' })).toBe('No frames: Taalcut couldn’t make a copy of this clip to play.');
    expect(lineOf({ kind: 'waiting' })).toBe('Waiting to lay out the frames.');
    expect(lineOf({ kind: 'failed', error })).toBe(
      'Taalcut couldn’t lay out the frames. Part of this clip couldn’t be decoded. It may be damaged.',
    );
    expect(lineOf({ kind: 'failed', error: null })).toBe('Taalcut couldn’t lay out the frames.');
    expect(lineOf({ kind: 'skipped' })).toBe('This clip has no frames to lay out.');
    expect(lineOf({ kind: 'again' })).toBe('The frames were let go to save space. They’re made again now.');
  });

  it('shows the empty frame alone for the skeleton', () => {
    const { container } = wrap(<ClipFilmstrip state={null} spans={[]} length={6000} ratio={9 / 16} />);
    expect(container.querySelector('[data-slot="clip-filmstrip"]')?.getAttribute('data-state')).toBe('none');
    expect(container.querySelector('[data-slot="clip-filmstrip-state"]')).toBeNull();
  });
});

describe('the frame under the pointer', () => {
  it('is the sprite frame nearest the moment, with the time', async () => {
    stubImages('load');
    const { container } = wrap(
      <ScrubHover hover={{ x: 40, at: 2600 }} width={400} filmstrip={STRIP} ratio={9 / 16} />,
    );
    await act(async () => {});
    const plate = container.querySelector('[data-slot="clip-scrub-hover"]');
    expect(plate?.hasAttribute('data-shown')).toBe(true);
    expect(plate?.querySelector('[data-frame]')?.getAttribute('data-frame')).toBe('3');
    expect(plate?.textContent).toContain('0:02');
  });

  it('is the time alone until the filmstrip is made', () => {
    const { container } = wrap(
      <ScrubHover hover={{ x: 40, at: 2600 }} width={400} filmstrip={null} ratio={9 / 16} />,
    );
    const plate = container.querySelector('[data-slot="clip-scrub-hover"]');
    expect(plate?.querySelector('[data-frame]')).toBeNull();
    expect(plate?.textContent).toContain('0:02');
  });
});
