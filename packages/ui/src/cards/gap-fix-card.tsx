// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap fix card (U2, P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · while the run asks it is a decision card (GapFixQuestion); after that a step panel on the
 *   sunken bed: the header ("Fix the gaps", "Fixed 2 of 3 gaps"), then every gap with its fixes (GapFixView)
 * states: asking (decision card) · default (open gaps and their rows) · pending (a row's own) · fixed (a gap folds to
 *   one line; the header counts) · already fixed (the live timeline moved on without this gap) · all settled (a
 *   success line) · disabled (no actions without a provider: the rows show what, not how)
 * motion: a gap's fold (GapItem) is the card's one motion
 * UX round 1: a failed answer brings the question back with its cause and Try again (it used to settle as sent)
 * FIX-ASK: the counts over the video on both; Add more clips adds a folder from this Mac or opens the phone page
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { CardOf, StockResult, Timeline } from '@taalcut/core';
import { CircleCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from '../feedback/toast-store';
import { SummaryLine } from '../gaps/gap-facts';
import { GapFixQuestion, type GapFixAnswer, type GapFacts } from '../gaps/gap-fix-question';
import { GapFixView, useSettledGaps } from '../gaps/gap-fix-view';
import type { GapFixHandlers, GapFixItem } from '../gaps/gap-types';
import { useCardActions } from './card-actions';
import { useCardData, useLiveTimeline } from './card-data';
import { StepHeader } from './step-header';
import { AnswerFailureLine, useAnswer } from './use-answer';

type Card = CardOf<'gapFix'>;

/** The card's gaps as the view shows them; one the live timeline no longer has as a gap is already fixed. */
function itemsOf(card: Card, live: Timeline | null | undefined): GapFixItem[] {
  const moved = live && live.revision > card.revision;
  const stillGaps = new Set<string>(
    moved ? (live.tracks[0]?.items ?? []).filter((item) => item.type === 'gap').map((item) => item.id) : [],
  );
  // A weak pick's id is its clip's, never a gap on V1: the live timeline can't say it was fixed.
  return card.gaps.map((gap) => ({
    ...gap,
    outcome: gap.outcome === 'open' && !gap.weak && moved && !stillGaps.has(gap.gapId) ? 'gone' : gap.outcome,
  }));
}

type Fixes = readonly GapFixAnswer[];

/**
 * The run's question. The make lane's GapFixQuestion settles itself once its answer resolves, so a failed answer
 * starts it again (a new key) with the cause and Try again under it.
 */
function Asking({
  approvalId,
  gaps,
  onSettings,
  handlers,
  facts,
}: {
  approvalId: string;
  gaps: GapFixItem[];
  onSettings: GapFixHandlers['onSettings'];
  handlers: Pick<GapFixHandlers, 'onAddFolder' | 'onPhone'>;
  facts: GapFacts;
}) {
  const answer = useAnswer<'fixes'>();
  const [round, setRound] = useState(0);
  const send = async (fixes: Fixes) => {
    const outcome = await answer.send('fixes', approvalId, 'approve', {
      answer: { kind: 'gapFix', fixes: [...fixes] },
    });
    if (outcome === null) setRound((n) => n + 1);
  };
  return (
    <div className="flex max-w-[42rem] flex-col gap-2">
      <GapFixQuestion
        key={`${approvalId}:${round}`}
        gaps={gaps}
        {...(answer.canAnswer ? { onAnswer: send } : {})}
        {...(onSettings ? { onSettings } : {})}
        handlers={handlers}
        facts={facts}
      />
      <AnswerFailureLine failure={answer.failure} />
    </div>
  );
}

export function GapFixCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const { stockSearch } = useCardData();
  const live = useLiveTimeline(card.asking ? null : card.timelineId);
  const items = useMemo(() => itemsOf(card, live), [card, live]);
  const { gaps, settle, fixed, total } = useSettledGaps(items);
  const { navigate, ask, dispatch, undo, stock, pickFolder } = actions;

  const onSettings: GapFixHandlers['onSettings'] = navigate
    ? (section) => navigate({ to: 'settings', section })
    : undefined;
  // FIX-ASK, Add more clips: the library's own import (a folder on this Mac) and the phone page.
  const adding: Pick<GapFixHandlers, 'onAddFolder' | 'onPhone'> = {
    ...(pickFolder && dispatch
      ? {
          onAddFolder: async () => {
            const picked = await pickFolder();
            if (!picked.ok || !picked.value) return picked;
            return dispatch('library.addSource', { path: picked.value.path });
          },
        }
      : {}),
    ...(navigate ? { onPhone: () => navigate({ to: 'phone' }) } : {}),
  };

  if (card.asking)
    return (
      <Asking
        approvalId={card.asking.approvalId}
        gaps={gaps}
        onSettings={onSettings}
        handlers={adding}
        facts={{ summary: card.summary, newClips: card.newClips, why: card.asking.why }}
      />
    );

  const handlers: GapFixHandlers = {
    ...adding,
    ...(navigate ? { onFilm: () => navigate({ to: 'phone' }) } : {}),
    ...(onSettings ? { onSettings } : {}),
    ...(stockSearch ? { onStockSearch: stockSearch } : {}),
    ...(ask
      ? {
          onGenerate: (gap: GapFixItem) => {
            const n = i18n.number(gap.number);
            ask(t`Generate an image for shot ${n}`, [
              {
                kind: 'range',
                timelineId: card.timelineId,
                range: { start: gap.start, duration: gap.duration },
              },
            ]);
          },
        }
      : {}),
    ...(stock
      ? {
          onStockUse: (gap: GapFixItem, item: StockResult) =>
            stock.use({ item, projectId: card.projectId, timelineId: card.timelineId, gapId: gap.gapId }),
        }
      : {}),
    ...(dispatch
      ? {
          onDrop: async (gap: GapFixItem) => {
            const result = await dispatch('timeline.dropSlot', {
              projectId: card.projectId,
              timelineId: card.timelineId,
              itemId: gap.gapId,
              mode: 'ripple',
            });
            if (result.ok) {
              const n = i18n.number(gap.number);
              toast({
                title: t`Shot ${n} dropped`,
                ...(undo ? { action: { label: t`Undo`, onSelect: () => void undo() } } : {}),
              });
            }
            return result;
          },
        }
      : {}),
  };

  const title = items.some((gap) => gap.weak) ? t`Fix the gaps and unsure clips` : t`Fix the gaps`;
  const done = i18n.number(fixed);
  return (
    <article
      data-slot="smart-card"
      data-card-type="gapFix"
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-4 rounded-xl bg-panel p-4"
    >
      <StepHeader
        title={title}
        step={card.step}
        aside={
          fixed > 0 ? (
            <span data-slot="gap-count" className="text-xs text-ink-2 tabular-nums">
              {t`Fixed ${done} of ${plural(total, { one: '# gap', other: '# gaps' })}`}
            </span>
          ) : null
        }
      />
      {card.summary ? <SummaryLine summary={card.summary} /> : null}
      <GapFixView gaps={gaps} onSettled={settle} {...handlers} />
      {fixed === total ? (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-success-strong">
          <CircleCheck aria-hidden className="size-4" />
          {t`Every gap is fixed.`}
        </p>
      ) : null}
    </article>
  );
}
