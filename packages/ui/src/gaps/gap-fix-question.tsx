// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap fix question (P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (Decision cards: raised, hairline all round, xl radius, no shadow, title 700) · the run asks
 *   how to fill its gaps: every gap with its fixes, Choose ticks one per gap into the answer, the primary says what
 *   it will do and what it costs ("Generate 2 images · about $0.08"), Not now declines (an empty answer)
 *   · FIX-ASK: what's wrong first (the counts, why it asks, what new clips came in), each gap starts with the fix
 *   Taalcut proposes chosen, and a line says the chat can answer too
 * states: default (nothing chosen: the primary is disabled and says why) · hover/active/focus-visible (the kit's
 *   Button) · loading (the primary while the answer goes) · error (the caller's toast; the card stays) · success
 *   (settles in place: "Fixing 2 gaps…" with the AI's running mark, or "Leaving the gaps for now.") · disabled
 *   (everything once answered, or without a way to answer)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { CardOf, GapAskReason, GapFixKind, GapSummary, Money, TimelineItemId } from '@taalcut/core';
import { useId, useState } from 'react';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { CardFrame } from '../cards/card-frame';
import { StatusMark } from '../chat/status-mark';
import { NewClipsLine, SummaryLine, WhyLine } from './gap-facts';
import { GapFixView } from './gap-fix-view';
import type { GapFixHandlers, GapFixItem, GapFixPick, SwapChoice } from './gap-types';

/** FIX-ASK: the card's facts over the whole video, and why the run asks. */
export interface GapFacts {
  readonly summary?: GapSummary | undefined;
  readonly newClips?: CardOf<'gapFix'>['newClips'];
  readonly why?: readonly GapAskReason[] | undefined;
}

/** One gap's answer; a swap names its clip (FIX-GAPS). */
export type GapFixAnswer = { gapId: TimelineItemId; fix: GapFixKind; swapTo?: SwapChoice };

export interface GapFixQuestionProps {
  gaps: readonly GapFixItem[];
  /** Sends the answer; [] declines. Absent: the question can't be answered here. */
  onAnswer?: (fixes: readonly GapFixAnswer[]) => void | Promise<void>;
  /** For the unavailable lines' settings links; FIX-ASK: and Add more clips' From this Mac and From your phone. */
  onSettings?: GapFixHandlers['onSettings'];
  handlers?: Pick<GapFixHandlers, 'onAddFolder' | 'onPhone'>;
  /** FIX-ASK: what's wrong over the whole video, why the run asks, and the clips that came in since. */
  facts?: GapFacts;
}

/** Each open gap's proposed fix, when the card offers it (FIX-ASK). */
function proposals(gaps: readonly GapFixItem[]): Map<TimelineItemId, GapFixPick> {
  const chosen = new Map<TimelineItemId, GapFixPick>();
  for (const gap of gaps) {
    const proposed = gap.outcome === 'open' ? gap.proposed : undefined;
    if (!proposed || !gap.options.some((option) => option.kind === proposed.fix)) continue;
    chosen.set(gap.gapId, { fix: proposed.fix, ...(proposed.swapTo ? { swapTo: proposed.swapTo } : {}) });
  }
  return chosen;
}

/** The chosen images' estimates added up (one currency: the agent prices in the account's). */
function totalCost(
  gaps: readonly GapFixItem[],
  chosen: ReadonlyMap<TimelineItemId, GapFixPick>,
): Money | null {
  const estimates = gaps.flatMap((gap) => {
    if (chosen.get(gap.gapId)?.fix !== 'generate') return [];
    const option = gap.options.find((candidate) => candidate.kind === 'generate');
    return option?.kind === 'generate' && option.estimate ? [option.estimate] : [];
  });
  const first = estimates[0];
  if (!first || estimates.some((estimate) => estimate.currency !== first.currency)) return null;
  return { currency: first.currency, micros: estimates.reduce((sum, estimate) => sum + estimate.micros, 0) };
}

export function GapFixQuestion({ gaps, onAnswer, onSettings, handlers, facts }: GapFixQuestionProps) {
  const { t } = useLingui();
  const format = useFormatters();
  const [chosen, setChosen] = useState<ReadonlyMap<TimelineItemId, GapFixPick>>(() => proposals(gaps));
  const why = useId();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const locked = sending || sent !== null || !onAnswer;
  const open = gaps.filter((gap) => gap.outcome === 'open');

  const answer = async (fixes: readonly GapFixAnswer[]) => {
    if (!onAnswer || locked) return;
    setSending(true);
    try {
      await onAnswer(fixes);
      setSent(fixes.length);
    } finally {
      setSending(false);
    }
  };
  const fixes = open.flatMap((gap): GapFixAnswer[] => {
    const pick = chosen.get(gap.gapId);
    if (!pick) return [];
    return [{ gapId: gap.gapId, fix: pick.fix, ...(pick.swapTo ? { swapTo: pick.swapTo } : {}) }];
  });
  const images = fixes.filter((entry) => entry.fix === 'generate').length;
  const cost = totalCost(open, chosen);
  const money = cost ? format.money(cost) : null;
  const count = fixes.length;

  const primary =
    images > 0 && images === count && money
      ? t`${plural(images, { one: 'Generate # image', other: 'Generate # images' })} · about ${money}`
      : money
        ? t`${plural(count, { one: 'Fix # gap', other: 'Fix # gaps' })} · about ${money}`
        : t`${plural(count, { one: 'Fix # gap', other: 'Fix # gaps' })}`;

  return (
    <CardFrame
      cardType="gapFix"
      data-asking=""
      title={
        open.some((gap) => gap.weak) ? (
          <Plural value={open.length} one="# shot needs a look" other="# shots need a look" />
        ) : (
          <Plural value={open.length} one="# shot has no clip yet" other="# shots have no clip yet" />
        )
      }
    >
      {facts?.summary ? <SummaryLine summary={facts.summary} /> : null}
      {facts?.why?.length ? <WhyLine why={facts.why} /> : null}
      {facts?.newClips ? <NewClipsLine clips={facts.newClips} /> : null}
      <p className="m-0 max-w-[60ch] text-sm text-ink-2">
        {chosen.size > 0
          ? t`Taalcut chose a fix for each shot below. Change any you like, then go on. Anything you leave stays a gap you can fix later in the editor.`
          : t`Choose a fix for each shot you want filled. Taalcut does the rest; anything you leave stays a gap you can fix later in the editor.`}
      </p>
      <GapFixView
        gaps={gaps}
        onSettled={() => undefined}
        {...handlers}
        choice={{
          chosen,
          locked,
          onChoose: (gapId, pick) =>
            setChosen((was) => {
              const next = new Map(was);
              if (pick) next.set(gapId, pick);
              else next.delete(gapId);
              return next;
            }),
        }}
        {...(onSettings ? { onSettings } : {})}
      />
      {sent !== null ? (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink">
          {sent > 0 ? (
            <>
              <StatusMark status="running" />
              <Plural value={sent} one="Fixing # gap…" other="Fixing # gaps…" />
            </>
          ) : (
            t`Leaving the gaps for now. Fix them any time in the editor.`
          )}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="primary"
            loading={sending}
            disabled={!onAnswer || count === 0}
            aria-describedby={count === 0 ? why : undefined}
            onClick={() => void answer(fixes)}
          >
            {primary}
          </Button>
          <Button variant="ghost" disabled={locked} onClick={() => void answer([])}>
            {t`Not now`}
          </Button>
          {count === 0 && onAnswer ? (
            <span id={why} className="text-xs text-ink-2">
              {t`Choose at least one fix.`}
            </span>
          ) : null}
        </div>
      )}
      {sent === null && onAnswer ? (
        <p data-slot="gap-chat-hint" className="m-0 max-w-[60ch] text-xs text-ink-2">
          {t`You can answer in the chat too, like “I added a clip, try again” or “use the walkway clip for the first shot”.`}
        </p>
      ) : null}
    </CardFrame>
  );
}
