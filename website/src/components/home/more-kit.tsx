// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · the drawings' kit · mode: Persuade · system: WEB2 Remix Vernacular
 * states: a drawing's run: finished (the server HTML, on screen at load, reduced motion: its end state, still) ·
 *   waiting (below the fold once the script runs: its start, out of sight) · playing (once a third of it is on screen:
 *   start to end in under 3.5 s, then still) · replaying (a mouse or trackpad pointer coming over it plays it again, at
 *   most every 1.6 s). Decorative: the tray is hidden from assistive technology and never focusable; the words beside
 *   it say the same. The toggle and the level control are drawings of the app's own, not controls.
 * The small parts the six drawings of More ways to make share: the run (kit's useReplay on the tray), the tray (a
 *   sunken, rounded inset with the app place it shows as its caption, a container for its own breakpoints), a switch
 *   drawn on, and a segmented choice with one picked. Transform and opacity only. */

import { motion } from 'motion/react';
import { type ReactNode, useCallback, useRef } from 'react';
import { cn } from '#lib/cn';
import { finePointer } from '#lib/pointer';
import { useReplay } from './kit';
import { pop } from './tour-motion';

/** How far apart two pointer replays may come, at least, in ms. */
const REPLAY_GAP = 1600;

/** A drawing's run on its tray: once on arrival, again under a fine pointer. */
export function useMoreRun() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay, reduce, ran, run } = useReplay(ref);
  const last = useRef(0);
  const onPointerEnter = useCallback(() => {
    if (reduce || !finePointer()) return;
    const now = Date.now();
    if (now - last.current < REPLAY_GAP) return;
    last.current = now;
    replay();
  }, [reduce, replay]);
  return { ref, state, ran, run, onPointerEnter } as const;
}

/**
 * The tray a drawing sits in: sunken under the canvas, its caption the app place it shows (an icon and words, as the
 * window bar names a page), the drawing below it as one motion tree driven by the run.
 */
export function Tray({
  place,
  icon,
  end,
  className,
  bodyClassName,
  children,
}: {
  readonly place: string;
  readonly icon: ReactNode;
  /** What the caption row shows at its right end (a source, a live state); hidden when the tray is narrow. */
  readonly end?: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly children: ReactNode;
}) {
  const { ref, state, onPointerEnter } = useMoreRun();
  return (
    <div
      ref={ref}
      aria-hidden
      data-slot="more-drawing"
      onPointerEnter={onPointerEnter}
      className={cn('@container relative isolate flex flex-col overflow-hidden rounded-2xl border border-rule-subtle bg-sunken text-ink', className)}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-rule-subtle bg-canvas/60 px-4 py-2">
        <span className="inline-flex min-w-0 items-center gap-2 type-label-sm font-semibold text-ink [&_svg]:size-4 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{place}</span>
        </span>
        {end ? <span className="hidden shrink-0 items-center gap-1.5 type-caption text-ink-2 @[24rem]:inline-flex">{end}</span> : null}
      </div>
      <motion.div initial={false} animate={state} className={cn('relative min-h-0 flex-1', bodyClassName)}>
        {children}
      </motion.div>
    </div>
  );
}

/** A switch as the app draws one, turned on as the run plays: the teal track fades over the empty one, the knob slides. */
export function SwitchOn({ at }: { readonly at: number }) {
  return (
    <span className="relative inline-block h-5 w-9 shrink-0 rounded-pill bg-rule">
      <motion.span
        className="absolute inset-0 rounded-pill bg-teal"
        variants={{ hidden: { opacity: 0, transition: { duration: 0 } }, shown: { opacity: 1, transition: { duration: 0.25, delay: at } } }}
      />
      <motion.span
        className="absolute top-0.5 left-0.5 size-4 rounded-full bg-raised shadow-sm"
        variants={{
          hidden: { x: 0, transition: { duration: 0 } },
          shown: { x: 16, transition: { type: 'spring', stiffness: 520, damping: 32, delay: at } },
        }}
      />
    </span>
  );
}

/** A segmented choice with one picked, as the app's segment controls draw it; the pick pops in on the run. */
export function Choice({ options, picked, at, className }: { readonly options: readonly string[]; readonly picked: number; readonly at: number; readonly className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-pill bg-control p-0.5', className)}>
      {options.map((o, i) => (
        <span key={o} className="relative inline-flex h-6 items-center px-2.5 type-caption whitespace-nowrap">
          {i === picked ? <motion.span variants={pop(at)} className="absolute inset-0 rounded-pill bg-raised shadow-sm ring-1 ring-rule-subtle" /> : null}
          <span className={cn('relative', i === picked ? 'font-semibold text-ink' : 'text-ink-2')}>{o}</span>
        </span>
      ))}
    </span>
  );
}
