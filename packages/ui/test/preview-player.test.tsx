// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PreviewPlayer on render's host contract (packages/render/SPEC.md, section 5),
 * with a stand-in `<hyperframes-player>`: jsdom can't run a composition. That
 * it plays under the app's CSP is checked in Electron by the UI lane's e2e.
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewPlayer, type PreviewPlayerHandle, type PreviewPlayerProps } from '../src/index';
import { frameAt, frameTime, framesIn } from '../src/player/player-element';

class FakePlayer extends HTMLElement {
  static made: FakePlayer[] = [];
  currentTime = 0;
  paused = true;
  readonly seeks: number[] = [];
  readonly iframeElement = document.createElement('iframe');
  constructor() {
    super();
    FakePlayer.made.push(this);
  }
  seek(seconds: number) {
    this.seeks.push(seconds);
    this.currentTime = seconds;
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  fire(type: string, detail?: unknown) {
    act(() => {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    });
  }
  /** Loaded and on screen, as the real player reports it. */
  load(seconds = 2) {
    this.fire('ready', { duration: seconds, compositionWidth: 1080, compositionHeight: 1920 });
    this.fire('painted');
  }
}
// Registered first, so definePlayer never loads the real one.
customElements.define('hyperframes-player', FakePlayer);

afterEach(() => {
  FakePlayer.made = [];
});

const RATE_30 = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const SRC = 'app://preview/0123456789abcdef0123456789abcdef/index.html?rev=0';
const wrap = (node: ReactNode) => <I18nProvider i18n={i18n}>{node}</I18nProvider>;

async function mount(props: Partial<PreviewPlayerProps> = {}) {
  const ref = createRef<PreviewPlayerHandle>();
  const all = (next: Partial<PreviewPlayerProps>) => ({ src: SRC, rate: RATE_30, ref, ...props, ...next });
  const view = render(wrap(<PreviewPlayer {...all({})} />));
  // definePlayer resolves on a microtask.
  await act(async () => undefined);
  const root = () => view.container.querySelector('[data-slot="preview-player"]')!;
  const rerender = async (next: Partial<PreviewPlayerProps>) => {
    view.rerender(wrap(<PreviewPlayer {...all(next)} />));
    await act(async () => undefined);
  };
  return { ...view, ref, root, rerender };
}

describe('PreviewPlayer', () => {
  it('shows the frame’s shape and a line when there is nothing to preview', async () => {
    const { root, rerender } = await mount({ src: null });
    expect(root().getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Nothing to preview yet.')).toBeTruthy();
    expect(FakePlayer.made).toHaveLength(0);
    await rerender({ empty: 'Pick a template to start.' });
    expect(screen.getByText('Pick a template to start.')).toBeTruthy();
  });

  it('loads under our skeleton, with no controls, no click-to-play and no loading card', async () => {
    const { root } = await mount();
    const [player] = FakePlayer.made;
    expect(player!.isConnected).toBe(true);
    expect(player!.getAttribute('src')).toBe(SRC);
    expect(player!.hasAttribute('disable-click-to-play')).toBe(true);
    expect(player!.getAttribute('assets-loading-ui')).toBe('none');
    expect(player!.hasAttribute('controls')).toBe(false);
    expect(player!.hasAttribute('type')).toBe(false);
    expect([player!.getAttribute('width'), player!.getAttribute('height')]).toEqual(['1080', '1920']);
    expect(player!.classList.contains('opacity-0')).toBe(true);
    expect(player!.classList.contains('pointer-events-none')).toBe(true);
    // The composition is a picture: out of the tab order, named for VoiceOver.
    expect(player!.iframeElement.tabIndex).toBe(-1);
    expect(player!.iframeElement.title).toBe('Video preview');
    expect(root().getAttribute('data-state')).toBe('loading');
    expect(screen.getByRole('group', { name: 'Video preview' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading preview');
    expect(root().querySelector('[data-slot="preview-bone"]')).not.toBeNull();
  });

  it('shows the frame once painted and reports the film in frames', async () => {
    const onReady = vi.fn();
    const { root } = await mount({ onReady });
    const [player] = FakePlayer.made;
    player!.fire('ready', { duration: 2, compositionWidth: 1080, compositionHeight: 1920 });
    expect(root().getAttribute('data-state')).toBe('loading');
    player!.fire('painted');
    expect(root().getAttribute('data-state')).toBe('ready');
    expect(player!.classList.contains('opacity-0')).toBe(false);
    expect(onReady).toHaveBeenCalledWith({ src: SRC, durationFrames: 60, width: 1080, height: 1920 });
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('group').hasAttribute('aria-busy')).toBe(false);
  });

  it('seeks to the middle of a frame and reports frames, not seconds', async () => {
    const onFrame = vi.fn();
    const { ref } = await mount({ rate: NTSC, durationFrames: 90, onFrame });
    const [player] = FakePlayer.made;
    player!.load(3);
    ref.current!.seekFrame(10);
    expect(player!.seeks.at(-1)).toBe((10.5 * 1001) / 30000);
    expect(ref.current!.currentFrame()).toBe(10);
    ref.current!.seekFrame(-4);
    expect(player!.seeks.at(-1)).toBe(frameTime(0, NTSC));
    ref.current!.seekFrame(5000);
    expect(player!.seeks.at(-1)).toBe(frameTime(89, NTSC));

    player!.fire('timeupdate', { currentTime: frameTime(12, NTSC) });
    player!.fire('timeupdate', { currentTime: frameTime(12, NTSC) + 0.001 });
    player!.fire('timeupdate', { currentTime: frameTime(13, NTSC) });
    expect(onFrame.mock.calls).toEqual([[12], [13]]);
  });

  it('opens on a frame asked for before it loaded, and passes play and pause through', async () => {
    const onPlayingChange = vi.fn();
    const { ref } = await mount({ onPlayingChange });
    const [player] = FakePlayer.made;
    ref.current!.seekFrame(24);
    expect(player!.seeks).toEqual([]);
    expect(ref.current!.currentFrame()).toBe(24);
    player!.load();
    expect(player!.seeks).toEqual([frameTime(24, RATE_30)]);
    act(() => ref.current!.play());
    expect(player!.paused).toBe(false);
    act(() => ref.current!.pause());
    expect(onPlayingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('loads an edit behind the frame on show, at the same frame, and swaps once it has painted', async () => {
    const onReady = vi.fn();
    const { root, rerender } = await mount({ onReady });
    const [first] = FakePlayer.made;
    first!.load();
    first!.currentTime = frameTime(40, RATE_30);
    act(() => first!.play());

    await rerender({ src: SRC.replace('rev=0', 'rev=1') });
    const second = FakePlayer.made[1]!;
    expect(second.getAttribute('src')).toContain('rev=1');
    // Behind the first (earlier in the stage) and hidden; the first stays on show.
    expect(second.nextElementSibling).toBe(first);
    expect(second.classList.contains('opacity-0')).toBe(true);
    expect(root().getAttribute('data-state')).toBe('ready');
    expect(root().hasAttribute('data-updating')).toBe(true);

    second.fire('ready', { duration: 2.5, compositionWidth: 1080, compositionHeight: 1920 });
    expect(second.seeks).toEqual([frameTime(40, RATE_30)]);
    second.fire('painted');
    expect(first!.isConnected).toBe(false);
    expect(second.classList.contains('opacity-0')).toBe(false);
    expect(second.paused).toBe(false);
    expect(root().hasAttribute('data-updating')).toBe(false);
    expect(onReady).toHaveBeenLastCalledWith({
      src: SRC.replace('rev=0', 'rev=1'),
      durationFrames: 75,
      width: 1080,
      height: 1920,
    });
  });

  it('drops an edit that is overtaken by the next one before it paints', async () => {
    const { rerender } = await mount();
    FakePlayer.made[0]!.load();
    await rerender({ src: SRC.replace('rev=0', 'rev=1') });
    await rerender({ src: SRC.replace('rev=0', 'rev=2') });
    const [first, second, third] = FakePlayer.made;
    expect(first!.isConnected).toBe(true);
    expect(second!.isConnected).toBe(false);
    expect(third!.isConnected).toBe(true);
  });

  it('says a failed load in one line, and Load again loads it again', async () => {
    const onError = vi.fn();
    const onRetry = vi.fn();
    const { root } = await mount({ onError, onRetry });
    const [player] = FakePlayer.made;
    player!.fire('error', { message: 'Composition timeline not found after 8s' });
    expect(root().getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The preview didn’t load.');
    expect(onError).toHaveBeenCalledWith('Composition timeline not found after 8s');
    expect(player!.isConnected).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Load again' }));
    await act(async () => undefined);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(FakePlayer.made).toHaveLength(2);
    expect(FakePlayer.made[1]!.getAttribute('src')).toBe(SRC);
    expect(root().getAttribute('data-state')).toBe('loading');
  });

  it('while the host gets a source: the loading bone, never an empty frame (UX1)', async () => {
    const { root, rerender } = await mount({ src: null, pending: true, empty: 'Preparing preview…' });
    expect(root().getAttribute('data-state')).toBe('loading');
    expect(root().querySelector('[data-slot="preview-bone"]')).not.toBeNull();
    expect(screen.queryByText('Preparing preview…')).toBeNull();
    await rerender({ src: SRC, pending: false });
    const [player] = FakePlayer.made;
    expect(player).toBeDefined();
    player?.load();
    expect(root().getAttribute('data-state')).toBe('ready');
  });

  it('when the host couldn’t get a source: its cause and Load again, which asks the host (UX1)', async () => {
    const onRetry = vi.fn();
    const { root, rerender } = await mount({
      src: null,
      failure: 'The video engine isn’t installed yet. Taalcut will get it, then try again.',
      onRetry,
    });
    expect(root().getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The video engine isn’t installed yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Load again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await rerender({ src: null, failure: null, pending: true });
    expect(root().getAttribute('data-state')).toBe('loading');
    expect(FakePlayer.made).toHaveLength(0);
  });

  it('plays a finished render as a video', async () => {
    const url = 'app://preview/0123456789abcdef0123456789abcdef/render.mp4';
    await mount({ src: url, type: 'video/mp4' });
    const [player] = FakePlayer.made;
    expect(player!.getAttribute('type')).toBe('video/mp4');
    player!.fire('error', { message: 'Video failed to load', code: 4 });
    expect(screen.getByRole('alert').textContent).toContain('This video didn’t load.');
  });

  it('idles while the window is hidden, follows muted, and goes when the page does', async () => {
    const { rerender, unmount } = await mount();
    const [player] = FakePlayer.made;
    expect(player!.hasAttribute('low-power-idle')).toBe(false);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(player!.hasAttribute('low-power-idle')).toBe(true);
    visibility.mockRestore();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(player!.hasAttribute('low-power-idle')).toBe(false);

    await rerender({ muted: true });
    expect(player!.hasAttribute('muted')).toBe(true);
    unmount();
    expect(player!.isConnected).toBe(false);
  });
});

describe('frame maths', () => {
  it('lands every frame on itself at 29.97, and absorbs float error at a boundary', () => {
    for (let frame = 0; frame < 2000; frame += 1) expect(frameAt(frameTime(frame, NTSC), NTSC)).toBe(frame);
    expect(frameAt(0.7, RATE_30)).toBe(21);
    expect(frameAt(-1, RATE_30)).toBe(0);
    expect(framesIn(2, RATE_30)).toBe(60);
    expect(framesIn(10.01, NTSC)).toBe(300);
    expect(framesIn(Number.NaN, RATE_30)).toBe(0);
  });
});
