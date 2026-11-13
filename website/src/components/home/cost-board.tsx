// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: cost board · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (the server HTML, on screen at load, reduced motion: every bar filled, every bracket and sticker in
 *   place) · running (once when it arrives, again from Play again in its head: the editor's bar fills a segment a beat,
 *   then the cloud AI's two, then the sliver on your computer; each saving's bracket draws out and its stickers pop;
 *   Kaatu pops by the zero last, all under three seconds) · A month (default) · A year (the figures and stickers
 *   change in place with a short rise, at once under reduced motion; the bars keep their lengths) · Play again: the
 *   kit's icon button (gone under reduced motion). Kaatu, where shown, follows a fine pointer.
 * What a month of videos costs, three ways, on one scale: the hired editor in ink, Taalcut with a cloud AI in violet
 * (the AI), Taalcut all on your computer in teal (yours), the climax nearly zero with Kaatu's heart hands beside it.
 * Each row says its name, what the money is, and the price in words; the bars and stickers are drawings of the same
 * figures. Every figure comes from #content/cost. */

import { Cloud, HandCoins, Laptop, type LucideIcon, ShieldCheck, TrendingDown, UserPen } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useId, useRef } from 'react';
import { Kaatu } from '#components/kaatu/kaatu';
import { IconText, type IconTone } from '#components/ui/icon-text';
import { backWords, COST_OPTIONS, COST_SECTION, type CostId, type CostPeriod, changeWords, per, price, usd } from '#content/cost';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { CostBar, type CostJob, Saved, type SavedSticker, SEGMENTS, segmentsFor, STEP } from './cost-bar';
import { PeriodSwitch } from './cost-period';
import { ReplayButton, useReplay } from './kit';
import { pop } from './tour-motion';

const LOOK: Readonly<Record<CostId, { readonly icon: LucideIcon; readonly tone: IconTone; readonly job: CostJob }>> = {
  editor: { icon: UserPen, tone: 'muted', job: 'ink' },
  cloud: { icon: Cloud, tone: 'ai', job: 'ai' },
  local: { icon: Laptop, tone: 'you', job: 'you' },
};

/** The run's script, in seconds: the editor's ten segments, then the cloud AI's, then the sliver. */
const SCALE = COST_OPTIONS[0].usd;
const FILLED: Readonly<Record<CostId, number>> = {
  editor: segmentsFor(COST_OPTIONS[0].usd, SCALE),
  cloud: segmentsFor(COST_OPTIONS[1].usd, SCALE),
  local: segmentsFor(COST_OPTIONS[2].usd, SCALE),
};
const AT: Readonly<Record<CostId, number>> = {
  editor: 0.2,
  cloud: 0.2 + FILLED.editor * STEP + 0.2,
  local: 0.2 + FILLED.editor * STEP + 0.2 + FILLED.cloud * STEP + 0.45,
};
const SAVED_AT = { cloud: AT.cloud + FILLED.cloud * STEP + 0.1, local: AT.local + 0.25 } as const;

/** The stickers under each saving: the money back, and the change against hiring. Fields are decoration, never a job. */
function stickersFor(id: Exclude<CostId, 'editor'>, period: CostPeriod, words: (k: string, text: string) => ReactNode): SavedSticker[] {
  return [
    { words: words(`back-${id}-${period}`, backWords(id, period)), field: 'lime', icon: HandCoins, tilt: -3, size: id === 'local' ? 'lg' : 'md' },
    { words: words(`change-${id}`, changeWords(id)), field: id === 'cloud' ? 'sky' : 'pink', icon: TrendingDown, tilt: 4, size: id === 'local' ? 'lg' : 'md' },
  ];
}

interface RowProps {
  readonly id: CostId;
  readonly period: CostPeriod;
  /** Words that change with the period rise into place, once the visitor has switched it. */
  readonly words: (k: string, text: string) => ReactNode;
}

function CostRow({ id, period, words }: RowProps) {
  const o = COST_OPTIONS.find((x) => x.id === id)!;
  const look = LOOK[id];
  const p = price(id, period);
  return (
    <li data-cost={id} className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="flex min-w-0 max-w-[26rem] flex-col gap-0.5">
          <IconText icon={look.icon} tone={look.tone} size="lg" className="type-site-body font-semibold text-ink">
            {o.name}{' '}
            {id === 'local' ? (
              <span className="ms-1 inline-flex translate-y-[-1px] items-center gap-1 rounded-pill bg-teal-soft px-2 py-0.5 align-middle type-meta font-semibold whitespace-nowrap text-teal-strong">
                <ShieldCheck aria-hidden className="size-3.5" />
                {COST_SECTION.localOnly}
              </span>
            ) : null}
          </IconText>
          <span className="ps-7 type-label-sm font-normal text-pretty text-ink-2">{o.line}</span>
        </div>
        <p data-slot="cost-price" className="m-0 flex items-baseline gap-1.5 ps-7 whitespace-nowrap">
          {/* The spaces between the parts are for the words read aloud and copied; the flex row lays them out. */}
          <span className="type-label text-ink-2">{p.approx}</span>{' '}
          {/* Nearly zero is the climax: the one figure at headline size. */}
          <span className={cn('font-extrabold text-ink', id === 'local' ? 'type-site-headline' : 'type-site-subhead')}>{words(`price-${id}-${period}`, usd(p.usd))}</span>{' '}
          <span className="type-label text-ink-2">{words(`per-${id}-${period}`, per(period))}</span>
        </p>
      </div>
      <CostBar filled={FILLED[id]} sliver={id === 'local'} job={look.job} at={AT[id]} className="mt-3" />
      {id === 'editor' ? null : (
        <Saved from={id === 'local' ? 0 : FILLED[id]} at={SAVED_AT[id]} stickers={stickersFor(id, period, words)} />
      )}
    </li>
  );
}

export interface CostBoardProps {
  readonly period: CostPeriod;
  readonly onPeriod: (p: CostPeriod) => void;
  /** Whether the visitor has switched the period: from then on, changed words rise into place. */
  readonly switched: boolean;
  /** Kaatu's heart hands by the zero (off where another Kaatu shares the screen). */
  readonly kaatu?: boolean;
  readonly className?: string;
}

export function CostBoard({ period, onPeriod, switched, kaatu = true, className }: CostBoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const basisId = useId();
  const { state, replay, reduce, run } = useReplay(ref, 0.35);
  const words = (k: string, text: string) => (
    <motion.span
      key={k}
      initial={switched && !reduce ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.short, ease: EASE_OUT }}
      className="inline-block"
    >
      {text}
    </motion.span>
  );
  return (
    <motion.div
      ref={ref}
      role="group"
      aria-labelledby={basisId}
      data-slot="cost-board"
      data-run={run}
      initial={false}
      animate={state}
      className={cn('relative rounded-reel bg-raised p-5 shadow-window ring-1 ring-rule-subtle sm:p-8', kaatu && 'pb-16 sm:pb-10', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="m-0 flex flex-col">
          <span id={basisId} className="type-site-body font-semibold text-ink">
            {words(`basis-${period}`, COST_SECTION.basis(period))}
          </span>
          <span className="type-meta text-ink-3">{COST_SECTION.currency}</span>
        </p>
        <span className="flex items-center gap-2">
          <PeriodSwitch value={period} onChange={onPeriod} />
          <ReplayButton onReplay={replay} label={COST_SECTION.replay} />
        </span>
      </div>
      <ol className="m-0 mt-7 flex list-none flex-col gap-7 p-0 sm:mt-8 sm:gap-8" data-segments={SEGMENTS}>
        {COST_OPTIONS.map((o) => (
          <CostRow key={o.id} id={o.id} period={period} words={words} />
        ))}
      </ol>
      {kaatu ? (
        // Kaatu hangs off the board's corner by the zero, a sticker character, the run's last beat.
        <motion.span variants={pop(SAVED_AT.local + 0.55)} className="pointer-events-none absolute -bottom-12 end-3 inline-flex sm:-bottom-14 sm:-end-5">
          <Kaatu pose="heart-hands" size={124} follow sticker className="max-sm:[--kaatu-size:5.5rem]" />
        </motion.span>
      ) : null}
    </motion.div>
  );
}
