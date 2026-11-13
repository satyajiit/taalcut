// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: tour · templates · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, reduced motion: the reel kept as a template, filled once with the Vietnam trip,
 *   two more fills waiting with their slots empty and Fill it again) · filling (on arrival and on Play again: the
 *   template lands, the trip's 13 clips drop into their slots one by one, then Fill it again pops, about 3 s)
 *   · Play again (kit: in the window's title bar)
 * The saved reel as a template in the coded app window: its slots and music beats, and the same template filled
 * again and again. The later fills are empty slots: they wait for new footage. */

import { CalendarClock, Images, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { IconText } from '#components/ui/icon-text';
import { SegmentBar } from '#components/ui/segment-bar';
import { Sticker } from '#components/ui/sticker';
import { TOUR } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { ReplayButton, Thumb, useReplay } from './kit';
import { REEL, REEL_SEGMENTS, SLOT_PICKS } from './reel-data';
import { pop, rise } from './tour-motion';

const LAND = 0.2;
const DROP = 0.75;
const STEP = 0.11;
const AGAIN = DROP + SLOT_PICKS.length * STEP + 0.25;

function Strip({ filled, at }: { readonly filled: boolean; readonly at: number }) {
  return (
    <span className="grid grid-cols-13 gap-1">
      {SLOT_PICKS.map((s, i) =>
        filled ? (
          <motion.span key={s.n} variants={pop(at + i * STEP)} className="block">
            <Thumb sprite={s.sprite} className="aspect-[9/16] w-full rounded-sm" />
          </motion.span>
        ) : (
          <span key={s.n} aria-hidden className="block aspect-[9/16] w-full rounded-sm border border-dashed border-rule-strong" />
        ),
      )}
    </span>
  );
}

export function TourTemplate() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay } = useReplay(ref);
  const t = TOUR.template;
  const [trip, weekend, month] = t.fills;
  const fills = [
    { label: trip, icon: Images, filled: true },
    { label: weekend, icon: CalendarClock, filled: false },
    { label: month, icon: CalendarClock, filled: false },
  ] as const;
  return (
    <div ref={ref} className="relative">
      <AppWindow title={t.title} area="templates" fit="fold" actions={<ReplayButton onReplay={replay} label={TOUR.replay} />}>
        <motion.div initial={false} animate={state} className="flex flex-col gap-5 p-5">
          <motion.div variants={rise(LAND)} className="flex flex-col gap-3 rounded-xl bg-raised p-4 shadow-sm ring-1 ring-rule-subtle">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <IconText icon={ICONS.template} tone="beat" className="type-label font-semibold text-ink">
                {t.name}
              </IconText>
              <span className="type-meta text-ink-2">{t.meta}</span>
            </div>
            <SegmentBar segments={REEL_SEGMENTS} beats={REEL.beats} state="filled" tone="surface" labels numbers />
          </motion.div>
          <div className="flex flex-col gap-4">
            {fills.map((row, i) => (
              <div key={row.label} className={cn('flex flex-col gap-2', i === 2 && 'opacity-70')}>
                <div className="flex min-h-7 items-center gap-3">
                  <IconText icon={row.icon} tone={row.filled ? 'you' : 'muted'} className="type-label text-ink">
                    {row.label}
                  </IconText>
                  {i === 1 ? (
                    <motion.span
                      variants={pop(AGAIN)}
                      className="ms-auto inline-flex shrink-0 origin-right items-center gap-1 rounded-pill bg-teal px-3 py-1 type-label font-semibold whitespace-nowrap text-teal-ink"
                    >
                      <Plus aria-hidden strokeWidth={ICON_STROKE + 0.5} className="size-3.5" />
                      {t.fill}
                    </motion.span>
                  ) : null}
                </div>
                <Strip filled={row.filled} at={DROP} />
              </div>
            ))}
          </div>
        </motion.div>
      </AppWindow>
      {/* On the window's top edge clear of its title; on a phone, where the bar is short, on its foot. */}
      <span className="pointer-events-none absolute right-4 -bottom-5 z-10 sm:top-[-1.25rem] sm:right-16 sm:bottom-auto">
        <Sticker field="teal" icon={ICONS.template} tilt={4} size="lg" className="pointer-events-auto">
          {t.saved}
        </Sticker>
      </span>
    </div>
  );
}
