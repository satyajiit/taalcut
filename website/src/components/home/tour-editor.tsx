// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: tour · editor · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, reduced motion: the agent's cut on the timeline, slot 7 swapped for another shot
 *   and marked in teal as yours, the export formats out) · editing (on arrival and on Play again: the clips land
 *   on the track, the playhead runs, slot 7's clip swaps in the preview and on the track and takes its teal mark,
 *   then the export pops, about 3.5 s) · Play again (kit: in the window's title bar). The window's Export is a
 *   drawing.
 * The editor in the coded app window: the viewer's stage with the 9:16 preview at its full height, then the owner's
 * 13 clips on the reel's clock with its music beats under them, a swap marked as yours, and the export. */

import { Music, Play, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { TOUR } from '#content/home';
import { ROLL_FRAMES } from '#content/reels';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { EASE_OUT } from '#lib/motion';
import { ReplayButton, Thumb, useReplay } from './kit';
import { clipSprite, REEL, shortTime, SLOT_PICKS } from './reel-data';
import { grow, pop, rise } from './tour-motion';

const LENGTH = REEL.durationSec;
const LAND = 0.15;
const RUN = 0.9;
const RUN_FOR = 2.2;
/** The playhead stops in slot 7 and the swap happens there. */
const SWAPPED = 7;
const SWAP_AT = RUN + RUN_FOR + 0.1;
const SWAP_TO = clipSprite('repeat-06') + 2;
const STOP = ((REEL.slots[SWAPPED - 1]!.start + REEL.slots[SWAPPED - 1]!.end) / 2) / LENGTH;
const at = (t: number) => `${((t / LENGTH) * 100).toFixed(2)}%`;

/** A clip on the track as a filmstrip of its own frames, enough to fill the longest slot. */
function filmstrip(clipId: string): number[] {
  const frames = ROLL_FRAMES.filter((f) => f.clipId === clipId).map((f) => f.sprite);
  return Array.from({ length: 16 }, (_, i) => frames[i % Math.max(1, frames.length)] ?? 0);
}

function TrackLabel({ icon, children }: { readonly icon: ReactNode; readonly children: string }) {
  return (
    <span className="flex w-[calc(var(--spacing)*24)] shrink-0 items-center gap-1.5 type-label text-ink-2">
      {icon}
      {children}
    </span>
  );
}

export function TourEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay } = useReplay(ref);
  const e = TOUR.editor;
  const swapped = REEL.slots[SWAPPED - 1]!;
  return (
    <div ref={ref}>
      <AppWindow
        title={e.title}
        area="make"
        fit="fold"
        actions={
          <>
            <ReplayButton onReplay={replay} label={TOUR.replay} />
            <span className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-rule bg-control px-3 type-label font-semibold text-ink">
              <Upload aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              {e.export}
            </span>
          </>
        }
      >
        <motion.div initial={false} animate={state} className="relative flex flex-col gap-4 p-5">
          <motion.span
            variants={pop(SWAP_AT + 0.6)}
            className="absolute -top-2 right-5 z-20 inline-flex origin-top-right items-center gap-1.5 rounded-xl bg-raised px-3 py-2 type-label font-semibold text-ink shadow-md ring-1 ring-rule"
          >
            <Upload aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-ink-3" />
            {e.formats}
          </motion.span>
          {/* The viewer: a stage 352 design px tall (over 300 px on a wide screen), the 9:16 preview at its full height. */}
          <div className="relative flex h-88 items-stretch justify-center rounded-lg bg-viewer p-3">
            <span data-slot="editor-preview" className="relative block aspect-[9/16] h-full overflow-hidden rounded-md">
              <Thumb sprite={SLOT_PICKS[SWAPPED - 1]!.sprite} className="absolute inset-0" />
              <motion.span
                className="absolute inset-0"
                variants={{ hidden: { opacity: 0, transition: { duration: 0 } }, shown: { opacity: 1, transition: { duration: 0.3, delay: SWAP_AT } } }}
              >
                <Thumb sprite={SWAP_TO} className="size-full" />
              </motion.span>
            </span>
            <span className="absolute bottom-3 left-4 inline-flex items-center gap-2 type-timecode text-viewer-ink">
              <Play aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" fill="currentColor" />
              {shortTime((swapped.start + swapped.end) / 2)} / {shortTime(LENGTH)}
            </span>
          </div>
          <div className="relative flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <TrackLabel icon={<ICONS.clip aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-teal-strong" />}>{e.tracks.video}</TrackLabel>
              <div className="relative h-14 flex-1">
                {SLOT_PICKS.map((s, i) => {
                  const slot = REEL.slots[i]!;
                  const mine = s.n === SWAPPED;
                  return (
                    <motion.span
                      key={s.n}
                      variants={grow(LAND + i * 0.04, 'x')}
                      style={{ left: at(slot.start), width: `calc(${at(slot.end - slot.start)} - var(--spacing) * 0.5)` }}
                      className="absolute inset-y-0 block origin-left"
                    >
                      <span className="flex size-full overflow-hidden rounded-sm">
                        {filmstrip(s.clipId).map((sprite, k) => (
                          <Thumb key={k} sprite={sprite} className="aspect-[9/16] h-full shrink-0" />
                        ))}
                      </span>
                      {mine ? (
                        <>
                          <motion.span
                            className="absolute inset-0"
                            variants={{ hidden: { opacity: 0, transition: { duration: 0 } }, shown: { opacity: 1, transition: { duration: 0.3, delay: SWAP_AT } } }}
                          >
                            <Thumb sprite={SWAP_TO} className="size-full rounded-sm" />
                          </motion.span>
                          <motion.span variants={pop(SWAP_AT)} className="pointer-events-none absolute -inset-0.5 rounded-md ring-2 ring-teal" />
                        </>
                      ) : null}
                    </motion.span>
                  );
                })}
                <motion.span
                  variants={pop(SWAP_AT + 0.15)}
                  style={{ left: at(swapped.start) }}
                  className="absolute -top-8 z-10 inline-flex origin-bottom-left -translate-x-1/2 items-center rounded-pill bg-teal px-2.5 py-0.5 type-caption font-semibold whitespace-nowrap text-teal-ink shadow-sm"
                >
                  {e.yours}
                </motion.span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <TrackLabel icon={<Music aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-rose-strong" />}>{e.tracks.music}</TrackLabel>
              <motion.div variants={grow(LAND + 0.2, 'x')} className="relative h-8 flex-1 origin-left rounded-sm bg-rose-soft">
                {REEL.beats.map((t) => (
                  <span key={t} aria-hidden style={{ left: at(t) }} className="absolute inset-y-1.5 w-0.5 -translate-x-1/2 rounded-pill bg-rose" />
                ))}
              </motion.div>
            </div>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-[calc(var(--spacing)*27)]">
              <motion.span
                className="absolute inset-y-0 left-0 block w-full"
                variants={{
                  hidden: { x: '0%', transition: { duration: 0 } },
                  shown: { x: `${(STOP * 100).toFixed(2)}%`, transition: { duration: RUN_FOR, ease: EASE_OUT, delay: RUN } },
                }}
              >
                <span className="absolute -inset-y-1 left-0 w-0.5 -translate-x-1/2 rounded-pill bg-ink" />
                <span className="absolute -top-2 left-0 size-2.5 -translate-x-1/2 rounded-full bg-ink" />
              </motion.span>
            </span>
          </div>
          <motion.p variants={rise(SWAP_AT + 0.4)} className="type-meta text-ink-2">
            {TOUR.rows.editor.also}
          </motion.p>
        </motion.div>
      </AppWindow>
    </div>
  );
}
