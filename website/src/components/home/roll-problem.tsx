// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: too many clips (problem-roll) · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, on screen at load, reduced motion: the 13 picks raised with their AI-pick chips,
 *   the rest of the roll stepped back) · scanning (on arrival and on Play again: a violet scan crosses the roll, and
 *   each pick lifts and takes its chip as the scan passes it, about 2 s) · a thumb lifts a hair under a fine pointer
 *   (decoration: the roll is a drawing, not a control) · narrow window (the chips keep the AI mark, drop the words)
 * The camera roll you never sorted: the coded app window on the owner's footage, 32 frames of a roll of 1,284 clips,
 * and the AI finding a clip for each of the reel's 13 slots. The roll's size rides the heading as its marker sticker;
 * Play again sits in the window's title bar. */

import { Check, ChevronDown, Images, LayoutGrid, Laptop, List, RectangleVertical } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { AppWindow } from '#components/ui/app-window';
import { IconText } from '#components/ui/icon-text';
import { Sticker } from '#components/ui/sticker';
import { ROLL_PROBLEM, TOUR } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { EASE_OUT, POP } from '#lib/motion';
import { HomeSection } from './home-section';
import { AiPickChip, ReplayButton, Thumb, useReplay } from './kit';
import { clipDuration, rollWall } from './reel-data';

const COLUMNS = 8;
const CELLS = rollWall(COLUMNS * 4);
/** The scan starts this long after arrival and takes this long to cross the roll. */
const SCAN_START = 0.35;
const SCAN = 1.7;

function passes(index: number): number {
  return SCAN_START + (((index % COLUMNS) + 0.5) / COLUMNS) * SCAN;
}

function RollWindow() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay, ran } = useReplay(ref, 0.45);
  const w = ROLL_PROBLEM.window;
  return (
    <div ref={ref}>
      <div className="relative">
        <AppWindow title={w.title} area="library" sidebar={false} size="md" actions={<ReplayButton onReplay={replay} label={TOUR.replay} />}>
          <div className="flex items-center gap-3 border-b border-rule-subtle px-4 py-3">
            <IconText icon={Images} tone="you" className="type-label font-semibold text-ink">
              {w.roll}
            </IconText>
            <span className="type-meta text-ink-2">{w.count}</span>
            <span aria-hidden className="ms-auto flex items-center gap-1 rounded-lg bg-control p-0.5">
              <span className="inline-grid size-7 place-items-center rounded-md bg-raised text-ink shadow-xs">
                <LayoutGrid strokeWidth={ICON_STROKE} className="size-4" />
              </span>
              <span className="inline-grid size-7 place-items-center rounded-md text-ink-3">
                <List strokeWidth={ICON_STROKE} className="size-4" />
              </span>
            </span>
            <span aria-hidden className="hidden items-center gap-1.5 rounded-lg border border-rule px-3 py-1.5 type-meta text-ink-2 @md:flex">
              {w.sort}
              <ChevronDown strokeWidth={ICON_STROKE} className="size-3.5" />
            </span>
          </div>
          <motion.div initial={false} animate={state} className="relative grid grid-cols-8 gap-1.5 overflow-hidden p-4">
            {CELLS.map((cell, i) => (
              <motion.span
                key={`${cell.sprite}-${i}`}
                data-picked={cell.picked || undefined}
                className={cn('relative block', cell.picked && 'z-10')}
                variants={
                  cell.picked
                    ? {
                        hidden: { scale: 1, y: 0, transition: { duration: 0 } },
                        shown: { scale: 1.07, y: -3, transition: { ...POP.spring, delay: passes(i) } },
                      }
                    : {
                        hidden: { opacity: 1, transition: { duration: 0 } },
                        shown: { opacity: 0.45, transition: { duration: 0.5, ease: EASE_OUT, delay: passes(i) } },
                      }
                }
              >
                <Thumb
                  sprite={cell.sprite}
                  className="aspect-square rounded-md transition-transform duration-(--dur-short) ease-(--ease-out) hover:-translate-y-0.5 motion-reduce:transition-none"
                >
                  <span className="absolute right-1 bottom-1 rounded-sm bg-viewer/70 px-1 type-timecode text-viewer-ink">{clipDuration(cell.clipId)}</span>
                </Thumb>
                {cell.picked ? (
                  <>
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute -inset-0.5 rounded-lg ring-2 ring-violet shadow-lift"
                      variants={{ hidden: { opacity: 0, transition: { duration: 0 } }, shown: { opacity: 1, transition: { duration: 0.2, delay: passes(i) } } }}
                    />
                    <motion.span
                      className="absolute top-1 left-1 origin-top-left"
                      variants={{
                        hidden: { scale: POP.scale, opacity: 0, transition: { duration: 0 } },
                        shown: { scale: 1, opacity: 1, transition: { ...POP.spring, delay: passes(i) + 0.08 } },
                      }}
                    >
                      <AiPickChip solid narrow label={ROLL_PROBLEM.pickChip} />
                    </motion.span>
                  </>
                ) : null}
              </motion.span>
            ))}
            {/* The scan: a violet line with a soft wake, crossing the roll once. At rest it is gone, so it mounts only
                once a run has started in the browser: the server HTML holds no layer waiting at opacity 0. */}
            {ran ? (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-20 w-full"
                variants={{
                  hidden: { x: '-4%', opacity: 0, transition: { duration: 0 } },
                  shown: { x: ['-4%', '100%'], opacity: [0, 1, 1, 0], transition: { duration: SCAN, delay: SCAN_START, ease: 'linear' } },
                }}
              >
                <span className="absolute inset-y-0 left-0 w-24 -translate-x-full bg-linear-to-r from-transparent to-violet/20" />
                <span className="absolute inset-y-0 left-0 w-0.5 bg-violet" />
              </motion.span>
            ) : null}
          </motion.div>
          <div className="flex items-center gap-2 border-t border-rule-subtle px-4 py-3">
            <AiMark className="size-4 text-violet-strong" />
            <span className="type-label text-ink">{w.found}</span>
            <Check aria-hidden strokeWidth={ICON_STROKE} className="ms-auto size-4 text-teal-strong" />
          </div>
        </AppWindow>
        <span className="pointer-events-none absolute -bottom-5 left-6 z-10">
          <Sticker field="violet" mark={<AiMark />} tilt={-4} delay={0.6} className="pointer-events-auto">
            {ROLL_PROBLEM.picked}
          </Sticker>
        </span>
      </div>
    </div>
  );
}

export function RollProblem() {
  const [indexes, slots, picks] = ROLL_PROBLEM.facts;
  return (
    <HomeSection
      id={ROLL_PROBLEM.id}
      heading={ROLL_PROBLEM.heading}
      marker={
        <Sticker field="pink" icon={Images} tilt={5} size="lg">
          {ROLL_PROBLEM.sticker}
        </Sticker>
      }
      lead={ROLL_PROBLEM.lead}
      aside={
        <ul className="flex flex-col gap-3">
          <IconText as="li" icon={Laptop} tone="you" className="type-site-body text-ink">
            {indexes}
          </IconText>
          <IconText as="li" icon={RectangleVertical} tone="beat" className="type-site-body text-ink">
            {slots}
          </IconText>
          <IconText as="li" mark={<AiMark />} tone="ai" className="type-site-body text-ink">
            {picks}
          </IconText>
        </ul>
      }
    >
      <RollWindow />
    </HomeSection>
  );
}
