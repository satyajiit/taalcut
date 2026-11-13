// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The plumbing between React and `<hyperframes-player>` (@hyperframes/player
 * 0.8.209), on the host contract in packages/render/SPEC.md section 5: our
 * transport, our skeleton, and frames, not seconds, at the boundary.
 */
import type { FrameRate } from '@taalcut/core';
import { useEffect, useState, type RefObject } from 'react';

export const PLAYER_TAG = 'hyperframes-player';

/** The part of HyperframesPlayer used here; the tests stand in an element with just these. */
export interface PlayerElement extends HTMLElement {
  play(): void;
  pause(): void;
  seek(timeInSeconds: number): void;
  readonly currentTime: number;
  readonly paused: boolean;
  /** The composition's iframe, inside the player's shadow root. */
  readonly iframeElement: HTMLIFrameElement | null;
}

/** One loaded (or loading) player, with the listeners that end when it goes. */
export interface PlayerLayer {
  readonly el: PlayerElement;
  readonly off: AbortController;
  /** From the player's `ready` event. */
  film?: { readonly seconds: number; readonly width: number; readonly height: number };
}

let defining: Promise<unknown> | null = null;

/**
 * Registers the element. The player's code (about 110 KB) loads the first
 * time a preview opens, not with every page that imports the kit.
 */
export function definePlayer(): Promise<unknown> {
  if (customElements.get(PLAYER_TAG)) return Promise.resolve();
  defining ??= import('@hyperframes/player').catch((error: unknown) => {
    // A failed chunk load may work next time (Load again), so don't keep the failure.
    defining = null;
    throw error;
  });
  return defining;
}

export interface PlayerOptions {
  readonly src: string;
  readonly type?: 'video/mp4';
  readonly width: number;
  readonly height: number;
  readonly poster?: string;
  readonly muted: boolean;
  readonly idle: boolean;
  /** The iframe's name for screen readers. */
  readonly title: string;
}

/** A player set up per the host contract, hidden until it paints. */
export function createPlayer(options: PlayerOptions): PlayerElement {
  const el = document.createElement(PLAYER_TAG) as PlayerElement;
  // No `controls` (the host draws the transport) and no click-to-play (the host's overlays own clicks).
  el.setAttribute('disable-click-to-play', '');
  // Our skeleton, not the player's loading card.
  el.setAttribute('assets-loading-ui', 'none');
  el.setAttribute('width', String(options.width));
  el.setAttribute('height', String(options.height));
  if (options.type) el.setAttribute('type', options.type);
  if (options.poster) el.setAttribute('poster', options.poster);
  el.toggleAttribute('muted', options.muted);
  el.toggleAttribute('low-power-idle', options.idle);
  el.setAttribute('src', options.src);
  // The composition is a picture, not an interface: pointer events fall through to the host's
  // overlays, and focus never moves into the cross-origin frame, where the app's keys don't reach.
  el.className = 'pointer-events-none absolute inset-0 size-full opacity-0';
  const frame = el.iframeElement;
  if (frame) {
    frame.tabIndex = -1;
    frame.title = options.title;
  }
  return el;
}

/** Stops a layer's listeners and takes its player out (which pauses it and frees its document). */
export function dropLayer(layer: PlayerLayer | null | undefined): void {
  if (!layer) return;
  layer.off.abort();
  layer.el.remove();
}

/**
 * The time in the middle of frame `frame`: a seek onto a frame's boundary can
 * show the frame before it (SPEC section 5: `seek((k + 0.5) / fps)`).
 */
export function frameTime(frame: number, rate: FrameRate): number {
  return ((frame + 0.5) * rate.den) / rate.num;
}

// Absorbs float error at a boundary: 0.7 s at 30 fps is 20.999999999999996 frames.
const EPSILON = 1e-6;

/** The frame showing at `seconds`: ⌊seconds · fps⌋. */
export function frameAt(seconds: number, rate: FrameRate): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor((seconds * rate.num) / rate.den + EPSILON);
}

/** How many frames a film of `seconds` holds. */
export function framesIn(seconds: number, rate: FrameRate): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((seconds * rate.num) / rate.den);
}

/**
 * True while nobody can see the viewer: the window is hidden or the frame is
 * scrolled away. A paused player then checks in once a second, not every 80 ms
 * (`low-power-idle`).
 */
export function useOutOfSight(target: RefObject<Element | null>): boolean {
  const [hidden, setHidden] = useState(false);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    const el = target.current;
    const observer =
      el && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => setAway(!entries.some((entry) => entry.isIntersecting)))
        : null;
    if (el) observer?.observe(el);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [target]);
  return hidden || away;
}
