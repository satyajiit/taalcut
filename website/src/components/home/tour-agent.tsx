// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: tour · the agent · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, reduced motion: your ask, the agent's three steps done, your version ready with
 *   Approve and Undo) · working (on arrival and on Play again: the ask lands, each step ticks off in turn, then the
 *   result card rises, about 3.5 s) · Play again (kit: in the window's title bar). The window's Approve, Undo and
 *   composer are drawings.
 * One sentence to the agent in the coded app window, and its run: read, pick, check against the reel, then one
 * approval. */

import { ArrowUp, Check, Undo2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { AppWindow } from '#components/ui/app-window';
import { HOW, TOUR } from '#content/home';
import { ICON_STROKE } from '#lib/icons';
import { ReplayButton, Thumb, useReplay } from './kit';
import { pop, rise } from './tour-motion';

const ASK = 0.2;
const STEP_AT = (i: number) => 0.8 + i * 0.65;
const READY = STEP_AT(3) + 0.1;

export function TourAgent() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay } = useReplay(ref);
  const a = TOUR.agent;
  return (
    <div ref={ref}>
      <AppWindow title={a.title} area="agent" fit="fold" actions={<ReplayButton onReplay={replay} label={TOUR.replay} />}>
        <motion.div initial={false} animate={state} className="flex flex-col gap-4 p-5">
          <motion.p variants={rise(ASK)} className="ms-auto max-w-[80%] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 type-body text-ink">
            {a.ask}
          </motion.p>
          <div className="flex flex-col gap-2.5">
            <motion.span variants={rise(ASK + 0.35)} className="flex items-center gap-2 type-label font-semibold text-ink">
              <AiMark className="size-4 text-violet-strong" />
              {a.who}
            </motion.span>
            <ol className="flex flex-col gap-2 ps-6">
              {a.steps.map((step, i) => (
                <motion.li key={step} variants={rise(STEP_AT(i))} className="flex items-center gap-2.5 type-body text-ink-2">
                  <motion.span variants={pop(STEP_AT(i) + 0.4)} className="inline-grid size-5 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-strong">
                    <Check aria-hidden strokeWidth={ICON_STROKE + 0.5} className="size-3" />
                  </motion.span>
                  {step}
                </motion.li>
              ))}
            </ol>
          </div>
          <motion.div variants={rise(READY)} className="ms-6 flex items-center gap-3 rounded-xl bg-raised p-3 shadow-sm ring-1 ring-rule-subtle">
            <Thumb sprite={42} className="aspect-[9/16] w-10 shrink-0 rounded-md" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="type-label font-semibold text-ink">{a.ready}</span>
              <span className="type-meta text-ink-2">{HOW.undo}</span>
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-pill px-3 type-label text-ink-2">
              <Undo2 aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              {a.undo}
            </span>
            <motion.span
              variants={pop(READY + 0.35)}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-inverse px-3.5 type-label font-semibold text-on-inverse"
            >
              <Check aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              {a.approve}
            </motion.span>
          </motion.div>
          <div className="mt-1 flex h-11 items-center gap-2 rounded-2xl border border-rule bg-raised ps-4 pe-1.5">
            <span className="flex-1 type-body text-ink-3">{a.composer}</span>
            <span className="inline-grid size-8 place-items-center rounded-full bg-control text-ink-2">
              <ArrowUp aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
            </span>
          </div>
        </motion.div>
      </AppWindow>
    </div>
  );
}
