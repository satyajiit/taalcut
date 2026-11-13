// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: QA report card (P2-M8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel: the summary in one line ("Checked: 18 of 19 passed"), then only what needs
 *   reading (failed, fixed, warnings) with their fixes; View details opens every check with what was measured
 * states: checking ("Checking your video…" with the AI's running mark while the Reviewer works) · passed (one line)
 *   · warnings (rows to read, nothing to do) · needs a look (failed rows, their fixes, Export anyway when allowed) ·
 *   Content Credentials failed (no Export anyway; one line on what to do instead) ·
 *   details loading (a quiet line) · details failed (the cause, Try again) · fix running (the button) · fix failed
 *   (the cause in one line) · disabled (the render is gone)
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, QaFix, QaReport, TaalcutError } from '@taalcut/core';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { StatusMark } from '../chat/status-mark';
import { errorMessage } from '../feedback/error-messages';
import { QaChecklist, QaSummaryLine, type QaChecklistItem } from '../make/qa-checklist';
import { qaCheckLabel, qaFixLabel } from '../make/render-words';
import { StepHeader } from './step-header';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';
import { VERB_ICONS } from '../icons/concepts';

type Details =
  { state: 'closed' } | { state: 'loading' } | { state: 'open'; report: QaReport } | { state: 'failed' };

export function QaReportCard({ card }: { card: CardOf<'qaReport'> }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const data = useCardData();
  const [details, setDetails] = useState<Details>({ state: 'closed' });
  const [error, setError] = useState<TaalcutError | null>(null);
  const checking = card.step?.status === 'running';
  // P3-V7: a signature that doesn't validate is never overridden (render SPEC P3.10).
  const credentialsFailed = card.checks.some(
    (check) => check.id === 'contentCredentials' && check.status === 'fail',
  );
  const title = t`Quality check`;

  const load = async () => {
    if (!data.qaReport) return;
    setDetails({ state: 'loading' });
    try {
      const report = await data.qaReport(card.renderId);
      setDetails(report ? { state: 'open', report } : { state: 'failed' });
    } catch {
      setDetails({ state: 'failed' });
    }
  };
  const toggle = () => (details.state === 'closed' ? void load() : setDetails({ state: 'closed' }));

  const fix = async (check: QaChecklistItem, action: QaFix) => {
    setError(null);
    if (action.kind === 'command') {
      const result = await actions.dispatch?.(action.command, action.payload);
      if (result && !result.ok) setError(result.error);
    } else if (action.kind === 'agent') {
      const name = qaCheckLabel(i18n, check.labelKey);
      const words = qaFixLabel(i18n, action.instructionKey, action.params);
      actions.ask?.(t`${name}: ${words}`, []);
    }
  };
  const override = async (checks: readonly string[]) => {
    setError(null);
    const result = await actions.dispatch?.('render.overrideQa', {
      projectId: card.projectId,
      renderId: card.renderId,
      checks,
    });
    if (result && !result.ok) setError(result.error);
  };

  const open = details.state !== 'closed';
  return (
    <article
      data-slot="smart-card"
      data-card-type="qaReport"
      data-verdict={card.summary.verdict}
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-2.5"
    >
      <StepHeader
        title={title}
        step={card.step}
        aside={
          data.qaReport && !checking ? (
            <Button size="sm" variant="ghost" aria-expanded={open} onClick={toggle}>
              {t`View details`}
              <ChevronDown
                aria-hidden
                className={cn(
                  'transition-transform duration-(--dur-micro) ease-(--ease-out)',
                  open && 'rotate-180',
                )}
              />
            </Button>
          ) : null
        }
      />
      {checking ? (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink">
          <StatusMark status="running" />
          {t`Checking your video…`}
        </p>
      ) : (
        <>
          <QaSummaryLine summary={card.summary} />
          {open ? null : (
            <QaChecklist
              checks={card.checks}
              {...(actions.dispatch || actions.ask ? { onFix: fix } : {})}
              {...(actions.dispatch ? { onOverride: override } : {})}
            />
          )}
          {details.state === 'loading' ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t`Loading every check…`}
            </p>
          ) : details.state === 'failed' ? (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p className="m-0 text-sm text-danger-strong">{t`The details didn’t load.`}</p>
              <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} onClick={() => void load()}>
                {t`Try again`}
              </Button>
            </div>
          ) : details.state === 'open' ? (
            <QaChecklist
              expanded
              checks={details.report.checks}
              {...(actions.dispatch || actions.ask ? { onFix: fix } : {})}
              {...(actions.dispatch ? { onOverride: override } : {})}
            />
          ) : null}
          {credentialsFailed ? (
            <p data-slot="credentials-failed" className="m-0 text-xs text-ink-2">
              {t`Content Credentials that don’t check out can’t be exported anyway. Export again, or turn them off in More options.`}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 text-sm text-danger-strong">
              {errorMessage(i18n, error)}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}
