// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · Shorts from long videos, drawn · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the run (more-kit): finished (the long video's three passages marked Hook, Context and Payoff, 60 s chosen,
 *   the portrait short beside it with its caption) · playing (the length is chosen, each passage opens along the long
 *   video in story order, then the short rises and its caption comes in word by word, about 3 s) · narrow tray (under
 *   24 rem the YouTube source leaves the caption row). Decorative (aria-hidden).
 * Make a short as the app has it: one long video (the owner's airport day, laid end to end) cut on whole sentences and
 *   scenes into one portrait short with captions; the YouTube link is one of its sources, by YouTube's own icon. */

import { Film } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandIcon } from '#components/brand/brand-icon';
import { MORE_WAYS } from '#content/home';
import { ICON_STROKE } from '#lib/icons';
import { Thumb } from './kit';
import { Choice, Tray } from './more-kit';
import { clipSprite, spriteStyle } from './reel-data';
import { grow, pop, rise } from './tour-motion';

const W = MORE_WAYS.rows.shorts;

/** The long video: the airport day's shots, then the city after and the road out of it, end to end. */
const DAY = ['airport-01', 'airport-02', 'airport-03', 'airport-04', 'airport-05', 'airport-07', 'airport-09', 'vietnam-01', 'repeat-12', 'vietnam-11', 'repeat-14'];
/** Enough frames for the widest strip (the strip clips the rest). */
const STRIP = [...DAY, ...DAY.slice(0, 10)];

/** Where each passage sits along the long video, as shares of it. */
const PASSAGES = [
  { from: 0.06, to: 0.17 },
  { from: 0.4, to: 0.55 },
  { from: 0.79, to: 0.9 },
] as const;

const OPEN = (i: number) => 0.5 + i * 0.4;
const SHORT = OPEN(2) + 0.5;

export function ShortsDrawing({ className }: { readonly className?: string }) {
  return (
    <Tray
      place={W.place}
      icon={<Film strokeWidth={ICON_STROKE} />}
      end={
        <span data-slot="icon-text" className="inline-flex items-center gap-1.5">
          <BrandIcon id="youtube" className="size-3.5" />
          {W.source}
        </span>
      }
      className={className}
      bodyClassName="grid grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-4 p-4 @[30rem]:gap-6 @[30rem]:p-5"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <span className="flex min-w-0 items-baseline justify-between gap-3 type-caption text-ink-2">
          <span className="truncate font-semibold text-ink">{W.video}</span>
          <span className="font-mono tabular-nums">{W.duration}</span>
        </span>
        {/* The long video, with its three passages marked over it (the labels ride above, outside the strip's clip). */}
        <div className="relative pt-6">
          <div className="flex h-14 overflow-hidden rounded-lg bg-viewer @[30rem]:h-16">
            {STRIP.map((id, i) => (
              <span key={`${id}-${i}`} className="aspect-[9/16] h-full shrink-0" style={spriteStyle(clipSprite(id))} />
            ))}
          </div>
          {PASSAGES.map((p, i) => (
            <span key={W.parts[i]} className="absolute top-0 bottom-0" style={{ left: `${p.from * 100}%`, width: `${(p.to - p.from) * 100}%` }}>
              <motion.span variants={grow(OPEN(i), 'x')} className="absolute inset-x-0 top-6 bottom-0 origin-left rounded-lg bg-rose/20 ring-2 ring-rose ring-inset" />
              <motion.span
                variants={pop(OPEN(i) + 0.2)}
                className="absolute top-0 left-0 inline-flex h-5 items-center rounded-pill bg-rose-soft px-1.5 type-caption font-semibold whitespace-nowrap text-rose-strong"
              >
                {W.parts[i]}
              </motion.span>
            </span>
          ))}
        </div>
        <Choice options={W.lengths} picked={1} at={0.2} className="self-start" />
      </div>
      {/* The short: portrait, its caption word by word. */}
      <motion.div variants={rise(SHORT)} className="flex flex-col items-center gap-1.5">
        <Thumb sprite={clipSprite('airport-05')} className="aspect-[9/16] w-[4.75rem] rounded-xl shadow-reel @[30rem]:w-24">
          <span className="absolute inset-x-1 bottom-3 flex flex-wrap justify-center gap-x-1 text-center text-[0.6875rem] leading-tight font-extrabold text-viewer-ink [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] @[30rem]:text-xs">
            {W.caption.map((word, i) => (
              <motion.span key={word} variants={pop(SHORT + 0.3 + i * 0.12)}>
                {word}
              </motion.span>
            ))}
          </span>
        </Thumb>
        <span className="type-caption whitespace-nowrap text-ink-2">
          {W.short} <span className="font-mono tabular-nums">{W.runs}</span>
        </span>
      </motion.div>
    </Tray>
  );
}
