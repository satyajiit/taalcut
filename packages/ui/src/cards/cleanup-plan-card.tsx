// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cleanup plan card (U7) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a decision card (CardFrame: raised, hairline, xl radius): what the cleanup would do in one sentence over the
 *   cut ("Remove 14 fillers, shorten 9 pauses, cut 2 retakes and add 3 punch-ins: 0:52 → 0:41"), the four
 *   switches (each one asks for a new plan; nothing changes), then Apply (the card's one marigold fill) and Open
 *   in the editor
 * states: proposed · re-planning (the numbers dim, the switch spins, Apply waits) · stale (the video changed
 *   since the plan: "Your video changed." and Check again) · applying (Apply spins) · applied (a success mark and
 *   "Cleaned up: 11s shorter"; the toast has Undo) · no speech found (one line) · error (the refusal, plainly) ·
 *   disabled (no actions here: the summary alone) · buttons and switches carry the eight
 * motion: the summary's dim is an opacity fade; nothing else moves · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { CircleCheck, RefreshCw } from 'lucide-react';
import { Button } from '#components/button';
import { CleanupSummary } from '../cleanup/cleanup-summary';
import { CleanupSwitches } from '../cleanup/cleanup-switches';
import { cleanupErrorWords } from '../cleanup/cleanup-words';
import { useCleanupReplan } from '../cleanup/use-cleanup-replan';
import { useFormatters } from '../lib/format';
import { useCardActions } from './card-actions';
import { useLiveTimeline } from './card-data';
import { CardFrame } from './card-frame';
import { usePrimaryVariant } from './primary-holder';

/** U7 (P3-V9): a talking head's cleanup plan with its numbers and Apply. */
export function CleanupPlanCard({ card }: { card: CardOf<'cleanupPlan'> }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const actions = useCardActions();
  const primary = usePrimaryVariant(card.id);
  const live = useLiveTimeline(card.plan.timelineId);
  const state = useCleanupReplan(card);
  const { plan, applied, error } = state;
  const noSpeech = error?.code === 'timeline.cleanup_no_speech';
  const stale =
    !applied &&
    (error?.code === 'timeline.cleanup_stale' ||
      (!!live && state.planning === null && live.revision !== plan.revision));
  const shorter = format.duration(plan.stats.secondsSaved * 1000);
  const open = () =>
    actions.navigate?.({
      to: 'timeline',
      projectId: card.projectId,
      timelineId: plan.timelineId,
      panel: 'cleanup',
    });
  const nothing = plan.stats.fillers + plan.stats.pauses + plan.stats.retakes + plan.stats.punchIns === 0;

  let body;
  if (applied)
    body = (
      <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink" data-slot="cleanup-applied">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
        {t`Cleaned up: ${shorter} shorter`}
      </p>
    );
  else if (noSpeech)
    body = (
      <p className="m-0 text-sm text-ink-2" data-slot="cleanup-no-speech">
        {cleanupErrorWords(i18n, error)}
      </p>
    );
  else
    body = (
      <>
        <CleanupSummary
          plan={plan}
          timeline={live}
          before={state.before}
          after={state.after}
          dimmed={state.planning !== null}
        />
        {stale ? (
          <p
            role="status"
            className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink"
            data-slot="cleanup-stale"
          >
            {t`Your video changed since this plan.`}
            <Button
              size="sm"
              variant="secondary"
              loading={state.planning === 'check'}
              disabled={!state.canPlan}
              onClick={() => void state.replan(state.switches, 'check')}
            >
              <RefreshCw aria-hidden />
              {t`Check again`}
            </Button>
          </p>
        ) : null}
        <CleanupSwitches
          value={state.switches}
          onChange={(next) => {
            const which = (Object.keys(next) as (keyof typeof next)[]).find(
              (key) => next[key] !== state.switches[key],
            );
            void state.replan(next, which ?? 'check');
          }}
          loading={state.planning === 'check' ? null : state.planning}
          disabled={!state.canPlan || state.applying}
        />
        {error && !stale ? (
          <p role="alert" className="m-0 text-sm text-danger-strong">
            {cleanupErrorWords(i18n, error)}
          </p>
        ) : null}
      </>
    );

  return (
    <CardFrame
      cardType="cleanupPlan"
      title={t`Clean up the speech`}
      aria-label={t`Clean up the speech`}
      data-state={
        applied
          ? 'applied'
          : noSpeech
            ? 'noSpeech'
            : stale
              ? 'stale'
              : state.planning
                ? 'replanning'
                : 'proposed'
      }
    >
      {body}
      {!noSpeech && (actions.dispatch || actions.navigate) ? (
        <div className="flex flex-wrap items-center gap-2">
          {!applied && actions.dispatch ? (
            <Button
              size="sm"
              variant={primary}
              loading={state.applying}
              disabled={stale || nothing || state.planning !== null}
              onClick={() => void state.apply(card.projectId)}
            >
              {t`Apply`}
            </Button>
          ) : null}
          {actions.navigate ? (
            <Button size="sm" variant={applied ? 'secondary' : 'ghost'} onClick={open}>
              {t`Open in the editor`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </CardFrame>
  );
}
