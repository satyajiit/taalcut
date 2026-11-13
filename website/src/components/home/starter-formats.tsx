// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: starter formats · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the row: at the start (Show earlier formats disabled) · in the middle · at the end (Show more formats
 *   disabled) · arrow buttons: default · hover (surface) · focus (base ring) · active (2 % give) · disabled (no
 *   surface, disabled ink) · a card: resting (its shape filled) · hover (lifts 4 px) · playing (a tap on the card or
 *   its Play: the shape fills on its own clock in about 2.5 s, then rests; under reduced motion it is full at once)
 *   · its Play: default · hover · focus (base ring) · active
 * The 8 starter templates in an English window, each card drawing that starter's real slots on its own clock
 * (#content/home-starters, copied from the shipped files), in a row that snaps card by card. */

import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Images, ListOrdered, Mic, Package, Play, Users, type LucideIcon } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { IconText } from '#components/ui/icon-text';
import { Arrive, Section } from '#components/ui/section';
import { SegmentBar } from '#components/ui/segment-bar';
import type { Segment } from '#components/ui/segments';
import { STICKER_FIELDS, type StickerField } from '#components/ui/sticker';
import { STARTERS_SECTION } from '#content/home';
import { STARTER_FORMATS, type StarterFormat } from '#content/home-starters';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { iconButtonClasses } from './kit';

const NEED_ICON: Readonly<Record<StarterFormat['need'], LucideIcon>> = {
  'many-clips': Images,
  'day-clips': CalendarDays,
  talking: Mic,
  product: Package,
  'two-clips': ArrowLeftRight,
  steps: ListOrdered,
  conversation: Users,
};
const FIELDS: readonly StickerField[] = ['pink', 'sky', 'lime', 'violet', 'teal', 'pink', 'sky', 'lime'];
/** Seconds a card's shape takes to fill when tapped. */
const PLAY_SECONDS = 2.5;

function FormatCard({ format, index }: { readonly format: StarterFormat; readonly index: number }) {
  const reduce = useReducedMotionPref();
  const time = useMotionValue(format.seconds);
  const [playing, setPlaying] = useState(false);
  const segments: Segment[] = format.slots.map(([start, end, group]) => ({ start, end, group }));
  const Need = NEED_ICON[format.need];
  const field = FIELDS[index % FIELDS.length]!;

  const play = () => {
    if (reduce) {
      time.set(format.seconds);
      return;
    }
    time.set(0);
    setPlaying(true);
  };
  useEffect(() => {
    if (!playing) return undefined;
    const controls = animate(time, format.seconds, { duration: PLAY_SECONDS, ease: 'linear', onComplete: () => setPlaying(false) });
    return () => controls.stop();
  }, [playing, time, format.seconds]);

  return (
    <li data-format={format.id} className="w-[min(17.5rem,78vw)] shrink-0 snap-start">
      <motion.div
        whileHover={reduce ? undefined : { y: -4 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        onClick={play}
        className="flex h-full cursor-pointer flex-col overflow-hidden rounded-[1.75rem] bg-raised shadow-sticker ring-1 ring-rule-subtle"
      >
        <div className={cn('relative flex h-28 items-end justify-between p-4', STICKER_FIELDS[field])}>
          <span className="type-sticker">
            {format.kind} · {STARTERS_SECTION.seconds(format.seconds)}
          </span>
          <Need aria-hidden strokeWidth={ICON_STROKE - 0.25} className={cn('absolute top-4 right-4 size-12 opacity-80', index % 2 ? 'rotate-6' : '-rotate-6')} />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-5">
          <h3 className="type-site-subhead text-ink">{format.name}</h3>
          <IconText icon={Need} tone="you" size="sm" className="type-label text-ink-2">
            {format.needs}
          </IconText>
          <SegmentBar
            segments={segments}
            time={time}
            state={playing ? 'playing' : 'filled'}
            layout="time"
            tone="surface"
            decorative
            className="mt-auto [&_[data-slot=segment]]:h-3"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="type-meta text-ink-2">{STARTERS_SECTION.slots(format.slots.length)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                play();
              }}
              aria-label={STARTERS_SECTION.play(format.name)}
              className={iconButtonClasses('md')}
            >
              <Play aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
            </button>
          </div>
        </div>
      </motion.div>
    </li>
  );
}

export function StarterFormats() {
  const row = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const reduce = useReducedMotionPref();

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const step = (direction: 1 | -1) => {
    const el = row.current;
    const card = el?.querySelector('li');
    if (!el || !card) return;
    el.scrollBy({ left: direction * (card.getBoundingClientRect().width + 20), behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <Section id="formats" heading={STARTERS_SECTION.heading} lead={STARTERS_SECTION.lead} tone="sunken">
      <Arrive className="flex justify-end gap-2">
        <button type="button" onClick={() => step(-1)} disabled={edges.start} aria-label={STARTERS_SECTION.previous} className={iconButtonClasses('lg')}>
          <ChevronLeft aria-hidden strokeWidth={ICON_STROKE} className="size-5" />
        </button>
        <button type="button" onClick={() => step(1)} disabled={edges.end} aria-label={STARTERS_SECTION.next} className={iconButtonClasses('lg')}>
          <ChevronRight aria-hidden strokeWidth={ICON_STROKE} className="size-5" />
        </button>
      </Arrive>
      <Arrive className="mt-6">
        <ul
          ref={row}
          onScroll={measure}
          aria-label={STARTERS_SECTION.region}
          className="-mx-gutter flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-gutter px-gutter pt-2 pb-8 [scrollbar-width:thin]"
        >
          {STARTER_FORMATS.map((format, i) => (
            <FormatCard key={format.id} format={format} index={i} />
          ))}
        </ul>
      </Arrive>
    </Section>
  );
}
