// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Taalcut mark (the logo with its motion) · mode: Persuade (brand) · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2, logo motion v1.0
 * A React wrapper for <taalcut-mark> (design/logo/motion/taalcut-mark.js, copied to /brand/motion/ by
 * scripts/brand-assets.mjs). The element's module loads once, on the client, from the served URL. Until it is
 * defined (on the server, without JavaScript, while it loads) the element shows its children: the drawn static lockup.
 * Once defined, its own drawing replaces them in place, with no shift.
 * states: idle (at rest) · keep-time (claps on the reel's tempo) · one-shots: count-in, tap (play()) · reduced motion:
 *   the element holds still (its own rule) · no JavaScript: the static lockup. */

import { type ReactNode, type Ref, useEffect } from 'react';
import { cn } from '#lib/cn';

export type TaalcutMarkMotion = 'count-in' | 'tihai' | 'tap';
export type TaalcutMarkState = 'idle' | 'keep-time' | 'thinking' | 'progress';

/** The element's API (design/logo/motion/taalcut-mark.d.ts), as the site uses it. */
export interface TaalcutMarkElement extends HTMLElement {
  state: TaalcutMarkState;
  bpm: number;
  readonly reducedMotion: boolean;
  play(name: TaalcutMarkMotion): Promise<void>;
  stop(): void;
}

interface TaalcutMarkAttributes {
  readonly ref?: Ref<TaalcutMarkElement>;
  readonly className?: string;
  readonly variant?: 'symbol' | 'lockup';
  readonly palette?: 'four' | 'two' | 'mono';
  readonly state?: TaalcutMarkState;
  readonly bpm?: number;
  readonly motion?: 'auto' | 'full' | 'reduced';
  readonly label?: string;
  readonly children?: ReactNode;
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- React's JSX types are a namespace
  namespace JSX {
    interface IntrinsicElements {
      'taalcut-mark': TaalcutMarkAttributes;
    }
  }
}

export const TAALCUT_MARK_SRC = '/brand/motion/taalcut-mark.js';

let loading: Promise<void> | null = null;

/** Loads the element's module once (a module script from the served URL) and resolves when it is defined. */
export function loadTaalcutMark(): Promise<void> {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return Promise.reject(new Error('no DOM'));
  if (customElements.get('taalcut-mark')) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = TAALCUT_MARK_SRC;
    script.onerror = () => {
      loading = null;
      reject(new Error('The logo’s motion did not load'));
    };
    document.head.append(script);
    void customElements.whenDefined('taalcut-mark').then(() => resolve());
  });
  return loading;
}

export interface TaalcutMarkProps {
  readonly ref?: Ref<TaalcutMarkElement>;
  readonly variant?: 'symbol' | 'lockup';
  readonly palette?: 'four' | 'two' | 'mono';
  readonly state?: TaalcutMarkState;
  /** The reel's tempo for keep-time, already folded into the logo's range. */
  readonly bpm?: number;
  /** What shows until the element is defined: the drawn static lockup. */
  readonly fallback: ReactNode;
  /** Called once the element is defined and upgraded (before the next paint). */
  readonly onReady?: () => void;
  readonly className?: string;
}

export function TaalcutMark({ ref, variant = 'lockup', palette = 'two', state = 'idle', bpm, fallback, onReady, className }: TaalcutMarkProps) {
  useEffect(() => {
    let live = true;
    loadTaalcutMark()
      .then(() => live && onReady?.())
      .catch(() => undefined); // The static lockup stays: the logo still shows, it just doesn't move.
    return () => {
      live = false;
    };
  }, [onReady]);

  return (
    <taalcut-mark
      ref={ref}
      className={cn('inline-block', className)}
      variant={variant}
      palette={palette}
      state={state}
      {...(bpm ? { bpm } : {})}
      label="Taalcut"
    >
      {fallback}
    </taalcut-mark>
  );
}
