// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: reel chrome · mode: Persuade (the Reels player's own furniture) · system: WEB2 Remix Vernacular
 * The native layers a saved reel plays under, drawn over the footage and under the bar and the pill: a top scrim
 * deep enough for the bar, the part names and the tabs, a bottom scrim for the rail and the audio row, the right rail
 * of actions (like, comment, send, remix), and the Original audio row with the reel's name running past.
 * states: at rest (the audio row's name still, cut at the edge) · playing (the name runs past, as Reels does, only
 *   while the reel plays: the reel's Pause stops it) · reduced motion (never runs) · without JavaScript (at rest).
 *   All decoration (aria-hidden, never a target): the reel's own label names it, and nothing here can be pressed.
 * Every word and glyph here is white with a shadow over the scrims, so it reads over any frame of the footage. */

import { Heart, MessageCircle, Music, Repeat2, Send } from 'lucide-react';
import { motion, useAnimationFrame, useMotionValue } from 'motion/react';
import { useRef } from 'react';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { DEMO } from '#components/hero/copy';

/** On the footage, white with a soft dark shadow: reads over the brightest frame. */
const ON_FOOTAGE = 'text-viewer-ink [filter:drop-shadow(0_1px_2px_var(--color-viewer))]';

/**
 * The scrims, black on the footage: the top reads 55 % dark at the edge, about 40 % halfway and a third at the tabs,
 * clear by 160 px; the foot likewise over 240 px, under the rail and the audio row. Over the saved reel they deepen
 * ReelFrame's own (55 % to 0 in 96 px) where that one fades; once Your version covers the frame's scrims (`cover`)
 * they carry it all.
 */
export function ReelScrims({ cover }: { readonly cover: boolean }) {
  return (
    <>
      <span
        aria-hidden
        data-slot="reel-scrim"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-48 bg-linear-to-b via-60% to-transparent',
          cover ? 'from-viewer/55 via-viewer/45' : 'from-transparent via-viewer/40',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-60 bg-linear-to-t via-45% to-transparent',
          cover ? 'from-viewer/55 via-viewer/30' : 'from-transparent via-viewer/25',
        )}
      />
    </>
  );
}

const RAIL = [Heart, MessageCircle, Send, Repeat2] as const;

/** The right rail, as Reels draws it: like, comment, send and remix. No counts: the site shows no numbers it can't stand behind. */
export function ReelRail({ className }: { readonly className?: string }) {
  return (
    <span aria-hidden data-slot="reel-rail" className={cn('pointer-events-none flex flex-col items-center gap-4', ON_FOOTAGE, className)}>
      {RAIL.map((Glyph, i) => (
        <Glyph key={i} strokeWidth={ICON_STROKE + 0.25} className="size-6" />
      ))}
    </span>
  );
}

/** px a second the reel's name runs at. */
const RUN = 28;

/** "Original audio · <the reel's name>", running past while the reel plays. */
export function AudioRow({ title, running, className }: { readonly title: string; readonly running: boolean; readonly className?: string }) {
  const x = useMotionValue(0);
  const copy = useRef<HTMLSpanElement>(null);
  useAnimationFrame((_, delta) => {
    const span = copy.current?.offsetWidth ?? 0;
    if (!running || span <= 0) return;
    let next = x.get() - (delta / 1000) * RUN;
    if (next <= -span) next += span;
    x.set(next);
  });
  const words = `${DEMO.audio} · ${title}`;
  return (
    <span aria-hidden data-slot="reel-audio" className={cn('pointer-events-none flex min-w-0 items-center gap-2 type-label-sm font-semibold', ON_FOOTAGE, className)}>
      <Music strokeWidth={ICON_STROKE + 0.25} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 overflow-hidden mask-x-from-85%">
        <motion.span className="flex w-max whitespace-nowrap" style={{ x }}>
          <span ref={copy} className="pe-8">
            {words}
          </span>
          <span className="pe-8">{words}</span>
        </motion.span>
      </span>
    </span>
  );
}
