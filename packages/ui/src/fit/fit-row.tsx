// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: a template that fits the footage · genre: atmospheric studio app · system: DESIGN.md v0.6
 * a hairline row: the template's name as written, how close the match is over every slot (what ranks the row; UX3:
 *   on the lime fit wash with a target, the one highlight in the facts, its words saying it too),
 *   how many of its slots the footage fills, what it is short of (at most two slots, each intent as written and
 *   why), and Make it
 * states: default · hover (hover surface on the row) · focus (base ring on Make it) · active (Make it pressed)
 *   · disabled (another start in flight, or this one started) · loading (Make it spins) · error (the cause under
 *   the row, Make it stays) · success (one line: the video is under way in this chat)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { FitWeakReason, TaalcutError, TemplateFit } from '@taalcut/core';
import { Check, Target } from 'lucide-react';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { Button } from '../components/button';

/** At most this many missing slots are named; the rest are counted. */
const NAMED_MISSING = 2;

function ReasonWords({ reason }: { reason: FitWeakReason }) {
  if (reason === 'orientation') return <Trans>only clips the other way round</Trans>;
  if (reason === 'taken') return <Trans>its clips fill other slots</Trans>;
  return <Trans>no clip long or sharp enough</Trans>;
}

/**
 * The fit as one match: the mean casting score over every slot, a slot the footage can't fill scoring 0. It is the
 * fit score timeline.fitTemplates ranks by (timeline SPEC, "LRN1-TPL", step 5); null when nothing is filled.
 */
export const fitMatch = (fit: TemplateFit): number | null =>
  fit.meanScore === null || fit.slots === 0 ? null : (fit.meanScore * fit.covered) / fit.slots;

/** "58% match · Fills 3 of 4 slots": what ranks the row, then how much of the template the footage fills. */
export function FitFacts({ fit }: { fit: TemplateFit }) {
  const format = useFormatters();
  const { covered, slots } = fit;
  const score = fitMatch(fit);
  const match = score === null ? null : format.percent(score);
  return (
    <span data-slot="fit-facts" className="text-sm text-ink-2 tabular-nums">
      {match === null ? null : (
        <>
          <span
            data-slot="fit-match"
            className="inline-flex items-center gap-1 rounded-pill bg-fit-soft px-1.5 font-semibold text-fit-strong"
          >
            <Target aria-hidden className="size-3.5 shrink-0" />
            <Trans>{match} match</Trans>
          </span>
          {' · '}
        </>
      )}
      {covered === slots ? (
        <Plural value={slots} one="Fills its # slot" other="Fills all # slots" />
      ) : covered === 0 ? (
        <Plural value={slots} one="Fills none of its # slot" other="Fills none of its # slots" />
      ) : (
        <Plural value={slots} one={`Fills ${covered} of # slot`} other={`Fills ${covered} of # slots`} />
      )}
    </span>
  );
}

/** What the template is short of: the first slots it can't fill, each intent as the template wrote it. */
export function FitMissing({ fit }: { fit: TemplateFit }) {
  const named = fit.weakSlots.slice(0, NAMED_MISSING);
  const more = fit.weakSlots.length - named.length;
  if (named.length === 0) return null;
  return (
    <ul data-slot="fit-missing" className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-ink-2">
      {named.map((slot) => {
        const number = slot.index + 1;
        const intent = slot.intent || '…';
        return (
          <li key={slot.slotId} className="min-w-0 [overflow-wrap:anywhere]">
            <Trans>
              Missing slot {number}:{' '}
              <UserContent translate="no" className="text-ink">
                {intent}
              </UserContent>{' '}
              (<ReasonWords reason={slot.reason} />)
            </Trans>
          </li>
        );
      })}
      {more > 0 ? (
        <li>
          <Plural value={more} one="and # more slot" other="and # more slots" />
        </li>
      ) : null}
    </ul>
  );
}

export interface FitRowProps {
  fit: TemplateFit;
  /** Another start is in flight. */
  disabled: boolean;
  /** This row's start is in flight. */
  busy: boolean;
  /** This row's video started in the chat. */
  started: boolean;
  error: TaalcutError | null;
  /** Absent: the host can't start a flow here, so the row only informs. */
  onMake?: (() => void) | undefined;
}

export function FitRow({ fit, disabled, busy, started, error, onMake }: FitRowProps) {
  const { t } = useLingui();
  const name = fit.summary.name;
  return (
    <li
      data-slot="fit-row"
      className="flex flex-col gap-1 border-t border-rule-subtle px-3 py-2 transition-colors duration-(--dur-micro) ease-(--ease-out) first:border-t-0 hover:bg-hover"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <UserContent translate="no" className="truncate text-base font-medium text-ink">
            {name}
          </UserContent>
          <FitFacts fit={fit} />
          <FitMissing fit={fit} />
        </div>
        {onMake ? (
          <Button
            size="sm"
            loading={busy}
            disabled={disabled || started}
            onClick={onMake}
            aria-label={t`Make a video with “${name}”`}
          >
            <Trans>Make it</Trans>
          </Button>
        ) : null}
      </div>
      {started ? (
        <p className="m-0 flex items-center gap-1.5 text-sm text-ink-2" role="status">
          <Check aria-hidden className="size-4 text-success-strong" />
          <Trans>Started in this chat</Trans>
        </p>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </li>
  );
}
