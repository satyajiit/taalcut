// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Hallmark · component: share problems (U3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · what keeps the template out of the hub, from hub.shareCheck, as a short list in words:
 *   where ("Slot 4, description") and what ("It has a web address in it."), each slot's line with Show slot
 * states: checking (two text bones, "Checking what would be sent") · problems (the list, warning words) · none
 *   ("Nothing to fix", success words) · Show slot: default · hover · focus-visible · active (Button's) · n/a:
 *   disabled, loading, error (the dialog's error line carries those)
 */
import { Plural, useLingui } from '@lingui/react/macro';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../components/button';
import { SkeletonLines } from '../skeleton/skeleton';
import { problemPlace, problemWords, type ShareProblem } from './share-words';

export interface ShareProblemsProps {
  readonly checking: boolean;
  readonly problems: readonly ShareProblem[];
  onShowSlot(slotIndex: number): void;
}

export function ShareProblems({ checking, problems, onShowSlot }: ShareProblemsProps) {
  const { t, i18n } = useLingui();
  const titleId = useId();
  const slotNumber = (index: number) => i18n.number(index + 1);
  if (checking)
    return (
      <div data-slot="share-problems" data-state="checking" className="flex flex-col gap-1">
        <p className="m-0 text-sm text-ink-2">{t`Checking what would be sent`}</p>
        <SkeletonLines lines={2} />
      </div>
    );
  if (problems.length === 0)
    return (
      <p
        data-slot="share-problems"
        data-state="clear"
        className="m-0 flex items-center gap-1.5 text-sm text-success-strong"
      >
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        {t`Nothing to fix: the hub can take this template.`}
      </p>
    );
  return (
    <section data-slot="share-problems" data-state="problems" aria-labelledby={titleId}>
      <h3 id={titleId} className="m-0 flex items-center gap-1.5 text-sm font-semibold text-warning-strong">
        <CircleAlert aria-hidden className="size-4 shrink-0" />
        <Plural value={problems.length} one="# thing to fix first" other="# things to fix first" />
      </h3>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
        {problems.map((problem, index) => {
          const slot = problem.slotIndex;
          const number = slot === null ? '' : slotNumber(slot);
          return (
            <li
              key={`${problem.path}-${problem.rule}-${index}`}
              data-problem-rule={problem.rule}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{problemPlace(i18n, problem)}</span>{' '}
                <span className="text-ink-2">{problemWords(i18n, problem)}</span>
              </span>
              {slot !== null ? (
                <Button size="sm" variant="ghost" onClick={() => onShowSlot(slot)}>
                  {t`Show slot ${number}`}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
