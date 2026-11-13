// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap item (P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one shot with no clip: "Shot 3 · 2.5 s", what it asks for in the template's words (user
 *   content) with its shot and camera chips, why nothing fits and the closest clip (FIX-ASK), then a row per fix and
 *   a quiet line per fix that isn't offered
 * states: open (the rows) · pending (a row's own) · filled / dropped / already fixed (folds to one line with a check:
 *   "Shot 3: stock video from Pexels", "Shot 5: dropped", "Shot 3: already fixed") · disabled (the answer went)
 *   · FIX-GAPS weak pick (the clip in it now and what happens by default, then a row per candidate; folds to
 *   "swapped for a clip that fits better" or "kept as it is") · FIX-ASK a clip from another shot, another part of a
 *   clip, Add more clips
 * motion: the fold is a height-free swap with a 150 ms fade on the line (opacity only)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GapFixKind } from '@taalcut/core';
import { CircleCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Chip } from '#components/badge';
import { useFormatters } from '#lib/format';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { UserContent } from '../cards/card-frame';
import { MOTION_LABELS, SHOT_TYPE_LABELS, toSeconds } from '../templates/slot-words';
import { BorrowRows, ReuseRows, SwapRows } from './clip-row';
import { FixRow } from './fix-row';
import { GapWants } from './gap-facts';
import type { GapFixChoice, GapFixHandlers, GapFixItem } from './gap-types';
import { UnavailableLine } from './unavailable-line';
import { WeakPickLines } from './weak-pick';

export interface GapItemProps {
  gap: GapFixItem;
  handlers: GapFixHandlers;
  choice?: GapFixChoice;
  /** A fix went through here: the caller folds the gap (and counts it). */
  onSettled: (outcome: 'filled' | 'dropped', via: GapFixItem['via']) => void;
  /** The heading's level: h4 in a card, h3 in the editor's popover. */
  level?: 3 | 4;
}

/** FIX-ASK: which shot a borrowed clip came from, or which shot's clip a reused part is of, from the proposal. */
function tradedWith(gap: GapFixItem, number: (n: number) => string) {
  const take = gap.proposed?.swapTo;
  const same = (c: { assetId: string; shotId: string | null }) =>
    take !== undefined && c.assetId === take.assetId && c.shotId === take.shotId;
  let from: string | null = null;
  let usedIn: string | null = null;
  for (const option of gap.options) {
    if (option.kind === 'borrow' && gap.proposed?.fix === 'borrow') {
      const found = option.candidates.find(same);
      if (found) from = number(found.from.number);
    }
    if (option.kind === 'reuse' && gap.proposed?.fix === 'reuse') {
      const found = option.candidates.find(same);
      if (found) usedIn = number(found.usedIn);
    }
  }
  return { from, usedIn };
}

function FoldedLine({ gap }: { gap: GapFixItem }) {
  const { t, i18n } = useLingui();
  const reduce = useReducedMotion();
  const n = i18n.number(gap.number);
  const { from, usedIn } = tradedWith(gap, i18n.number.bind(i18n));
  const words =
    gap.outcome === 'dropped'
      ? t`Shot ${n}: dropped`
      : gap.outcome === 'swapped'
        ? t`Shot ${n}: swapped for a clip that fits better`
        : gap.outcome === 'kept'
          ? gap.weak?.betterFit
            ? t`Shot ${n}: kept as it is`
            : t`Shot ${n}: kept as it is. None of your other clips fits it better.`
          : gap.outcome === 'borrowed'
            ? from !== null
              ? t`Shot ${n}: took the clip from shot ${from}, which got another clip instead`
              : t`Shot ${n}: now has the clip another shot had, and that shot got another`
            : gap.outcome === 'reused'
              ? usedIn !== null
                ? t`Shot ${n}: another part of the clip in shot ${usedIn}`
                : t`Shot ${n}: another part of a clip you used`
              : gap.outcome === 'gone'
                ? t`Shot ${n}: already fixed`
                : gap.via === 'stock'
                  ? t`Shot ${n}: stock video from Pexels`
                  : gap.via === 'image'
                    ? t`Shot ${n}: an image`
                    : t`Shot ${n}: filled`;
  return (
    <motion.p
      data-slot="gap-folded"
      data-outcome={gap.outcome}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={
        reduce ? { duration: REDUCED_FADE, ease: 'linear' } : { duration: DUR.short, ease: EASE_OUT }
      }
      className="m-0 flex items-center gap-2 text-sm text-ink"
    >
      <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
      {words}
    </motion.p>
  );
}

export function GapItem({ gap, handlers, choice, onSettled, level = 4 }: GapItemProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  if (gap.outcome !== 'open')
    return (
      <li data-slot="gap" data-gap-id={gap.gapId} data-outcome={gap.outcome} className="list-none">
        <FoldedLine gap={gap} />
      </li>
    );
  const n = i18n.number(gap.number);
  const length = format.duration(toSeconds(gap.duration) * 1000);
  const Heading = level === 3 ? 'h3' : 'h4';
  const intent = gap.intent;
  const chosen = choice?.chosen.get(gap.gapId) ?? null;
  const toggle = (kind: GapFixKind) =>
    choice?.onChoose(gap.gapId, chosen?.fix === kind ? null : { fix: kind });
  const clipChoose = choice
    ? {
        choose: {
          chosen,
          locked: choice.locked,
          onChoose: (pick: Parameters<GapFixChoice['onChoose']>[1]) => choice.onChoose(gap.gapId, pick),
        },
      }
    : {};
  return (
    <li data-slot="gap" data-gap-id={gap.gapId} data-outcome="open" className="flex list-none flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Heading className="m-0 text-sm font-semibold text-ink tabular-nums">{t`Shot ${n} · ${length}`}</Heading>
        {intent?.text ? (
          <p className="m-0 max-w-[60ch] text-sm text-ink">
            <UserContent translate="no">{intent.text}</UserContent>
          </p>
        ) : null}
        {intent?.shotType || intent?.motion ? (
          <span className="flex flex-wrap gap-1.5">
            {/* A wash one step off the surface: the card's panel is sunken, the popover raised. */}
            {intent.shotType ? (
              <Chip className="bg-hover">{i18n._(SHOT_TYPE_LABELS[intent.shotType])}</Chip>
            ) : null}
            {intent.motion ? <Chip className="bg-hover">{i18n._(MOTION_LABELS[intent.motion])}</Chip> : null}
          </span>
        ) : null}
        {gap.weak ? <WeakPickLines weak={gap.weak} borrows={gap.proposed?.fix === 'borrow'} /> : null}
        <GapWants gap={gap} />
      </div>
      <ul aria-label={t`Ways to fill shot ${n}`} className="m-0 flex list-none flex-col p-0">
        {gap.options.map((option) =>
          option.kind === 'swap' ? (
            <SwapRows key="swap" candidates={option.candidates} {...clipChoose} />
          ) : option.kind === 'borrow' ? (
            <BorrowRows key="borrow" candidates={option.candidates} {...clipChoose} />
          ) : option.kind === 'reuse' ? (
            <ReuseRows key="reuse" candidates={option.candidates} {...clipChoose} />
          ) : (
            <FixRow
              key={option.kind}
              gap={gap}
              option={option}
              handlers={handlers}
              onDone={(via) => onSettled(option.kind === 'drop' ? 'dropped' : 'filled', via)}
              {...(choice
                ? {
                    choose: {
                      chosen: chosen?.fix === option.kind,
                      locked: choice.locked,
                      onToggle: () => toggle(option.kind),
                    },
                  }
                : {})}
            />
          ),
        )}
      </ul>
      {gap.unavailable.length > 0 ? (
        <div className="flex flex-col gap-1">
          {gap.unavailable.map((line, index) => (
            <UnavailableLine
              key={`${line.kind}:${line.reason}`}
              kind={line.kind}
              reason={line.reason}
              // One link per reason: two lines that Local only explains share the first one's.
              {...(handlers.onSettings &&
              gap.unavailable.findIndex((other) => other.reason === line.reason) === index
                ? { onSettings: handlers.onSettings }
                : {})}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}
