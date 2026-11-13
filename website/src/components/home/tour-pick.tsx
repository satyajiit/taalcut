// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: tour · auto-pick · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, reduced motion: the search typed, four night shots found, each with how sure the
 *   AI is, the first picked for slot 7) · searching (on arrival and on Play again: the words type in, the clips
 *   pop in one by one, then the pick lands, about 3 s) · Play again (kit: in the window's title bar)
 * Search in plain words over the owner's footage, in the coded app window's Library. */

import { Search, RectangleVertical } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { IconText } from '#components/ui/icon-text';
import { ROLL_PROBLEM, type Sure, TOUR } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { AiPickChip, ReplayButton, SureMeter, Thumb, useReplay } from './kit';
import { clipDuration, clipSprite } from './reel-data';
import { dim, pop, rise, type } from './tour-motion';

/** The clips the words find: the night street under coloured lights (slot 7's pick) first, then three more nights. */
const RESULTS: readonly { readonly clipId: string; readonly sure: Sure }[] = [
  { clipId: 'vietnam-07', sure: 'high' },
  { clipId: 'vietnam-02', sure: 'high' },
  { clipId: 'vietnam-08', sure: 'medium' },
  { clipId: 'vietnam-10', sure: 'low' },
];
const TYPED = 0.25;
const TYPING = 1;
const FOUND = TYPED + TYPING + 0.15;
const PICK = FOUND + 0.25 + RESULTS.length * 0.18 + 0.3;

export function TourPick() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay, ran } = useReplay(ref);
  const p = TOUR.pick;
  return (
    <div ref={ref}>
      <AppWindow title={p.title} area="library" fit="fold" actions={<ReplayButton onReplay={replay} label={TOUR.replay} />}>
        <motion.div initial={false} animate={state} className="flex flex-col gap-4 p-5">
          <div className="flex h-11 items-center gap-2.5 rounded-xl border border-rule bg-raised px-3.5 shadow-xs">
            <Search aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-ink-3" />
            <motion.span variants={type(TYPED, TYPING)} className="type-body text-ink">
              {p.query}
            </motion.span>
            {/* The caret rests gone: it mounts once a run starts in the browser, never in the server HTML. */}
            {ran ? (
              <motion.span
                aria-hidden
                variants={{ hidden: { opacity: 1 }, shown: { opacity: 0, transition: { delay: FOUND } } }}
                className="-ms-1.5 h-5 w-0.5 rounded-pill bg-teal-strong"
              />
            ) : null}
          </div>
          <motion.span variants={rise(FOUND)} className="type-label text-ink-2">
            {p.found}
          </motion.span>
          <div className="grid grid-cols-4 gap-3">
            {RESULTS.map((r, i) => {
              const first = i === 0;
              return (
                <motion.div key={r.clipId} variants={pop(FOUND + 0.2 + i * 0.18)} className="flex flex-col gap-2">
                  <motion.span variants={first ? undefined : dim(PICK, 0.6)} className="relative block">
                    <Thumb sprite={clipSprite(r.clipId)} className="aspect-[9/16] w-full rounded-lg">
                      <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-viewer/70 px-1 type-timecode text-viewer-ink">{clipDuration(r.clipId)}</span>
                    </Thumb>
                    {first ? (
                      <>
                        <motion.span variants={pop(PICK)} aria-hidden className="pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-violet" />
                        <motion.span variants={pop(PICK + 0.1)} className="absolute top-1.5 left-1.5 origin-top-left">
                          <AiPickChip solid label={ROLL_PROBLEM.pickChip} />
                        </motion.span>
                      </>
                    ) : null}
                  </motion.span>
                  <SureMeter sure={r.sure} className={cn(first && 'text-ink')} />
                </motion.div>
              );
            })}
          </div>
          <motion.span variants={pop(PICK + 0.3)} className="origin-left self-start">
            <IconText icon={RectangleVertical} tone="beat" className="rounded-pill bg-rose-soft px-3 py-1 type-label font-semibold text-rose-strong">
              {p.slot}
            </IconText>
          </motion.span>
        </motion.div>
      </AppWindow>
    </div>
  );
}
