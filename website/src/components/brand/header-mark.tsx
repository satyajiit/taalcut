// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: header mark · mode: Persuade (site chrome) · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2, logo motion v1.0 (§5.1, 5.3, 5.6)
 * The header's lockup, two colours, with its motion:
 *   count-in: once a browser session, when the element first arrives (the ui store's countedIn);
 *   tap: one beat-one stroke when the pointer comes onto it, at most once every 600 ms;
 *   keep-time: on the home page while the hero's demo plays, at the chosen reel's tempo (reelById(reelId).tempo folded
 *     through keepTimeBeatMs, never faster than 1.5 strokes a second); at rest otherwise.
 * states: at rest · counting in · keeping time · tap · reduced motion (a still mark: no count-in, no tap, no keep-time)
 *   · no JavaScript or the module failed (the drawn static lockup). */

import { usePathname } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { reelById } from '#content/reels';
import { keepTimeBeatMs } from '#lib/motion';
import { useDemoStore } from '#stores/demo';
import { useUiStore } from '#stores/ui';
import { Logo } from './logo';
import { TaalcutMark, type TaalcutMarkElement } from './taalcut-mark';
import { prefersReducedMotion, useReducedMotionPref } from './use-reduced-motion';

/** A tap plays at most this often, so a pointer moving across the logo doesn't stutter it (README §5.6). */
const TAP_EVERY_MS = 600;

/** The keep-time tempo for a reel, as the element's bpm: the folded beat, never under 667 ms. */
export function keepTimeBpm(tempo: number): number {
  return Math.round(60_000 / keepTimeBeatMs(tempo));
}

export function HeaderMark({ className }: { readonly className?: string }) {
  const mark = useRef<TaalcutMarkElement>(null);
  const lastTap = useRef(0);
  const reduce = useReducedMotionPref();
  const home = (usePathname() ?? '/') === '/';
  const reelId = useDemoStore((s) => s.reelId);
  const playing = useDemoStore((s) => s.playing);
  const phase = useDemoStore((s) => s.phase);
  const keepTime = home && playing && phase !== 'approved' && !reduce;

  // Straight after the element is defined, before the next paint: the count-in starts hidden, so the lockup never
  // flashes whole before it counts itself in.
  const onReady = useCallback(() => {
    const { countedIn, markCountedIn } = useUiStore.getState();
    if (countedIn || prefersReducedMotion()) return;
    markCountedIn();
    void mark.current?.play('count-in');
  }, []);

  return (
    <span
      className="inline-flex"
      onPointerEnter={() => {
        const now = Date.now();
        if (reduce || now - lastTap.current < TAP_EVERY_MS) return;
        lastTap.current = now;
        void mark.current?.play?.('tap');
      }}
    >
      <TaalcutMark
        ref={mark}
        variant="lockup"
        palette="two"
        state={keepTime ? 'keep-time' : 'idle'}
        {...(keepTime ? { bpm: keepTimeBpm(reelById(reelId).tempo) } : {})}
        onReady={onReady}
        fallback={<Logo size="small" className="h-full" />}
        {...(className ? { className } : {})}
      />
    </span>
  );
}
