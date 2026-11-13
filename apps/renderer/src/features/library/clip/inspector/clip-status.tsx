// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: how far Taalcut has got with a clip (LIB1-PROG, after UX2's) · mode: Operate · system: DESIGN.md v0.7
 * leads with what the clip is good for already ("You can play and search this clip now"), or that it is analysed
 *   again; then one line for what Taalcut does now (or next) and roughly how long is left when this Mac knows; then
 *   the steps grouped by what they give (analysis-group-list.tsx), each in one state. Analyse again says what it
 *   found last time stays until each part is redone (the parts carry their own mark, stale-section.tsx). A clip
 *   held for on-device models adds the decision card (raised, rule hairline, xl radius, title 700) naming the
 *   models, what starts after them, and the download (clip-models.tsx). A failure names the step, the cause in the
 *   library's words and its one fix. A finished clip is one quiet line at the column's end. Every step, one by
 *   one, is behind "Show the steps"
 * states: complete · running (first analysis, again) · searchable or playable while running · next (between the
 *   library's polls) · waiting (a drive away) · held for models (the card; downloading; here) · failed (Try again
 *   when the step may pass, Analyse again when only a fresh start can; busy until the work shows) · the
 *   disclosure: default · hover (ink) · focus (base ring) · active · open (aria-expanded, the chevron turns)
 * contrast: heading ink, lines ink-2 (≥ 7:1, both themes); the again note ink-2; the danger glyph danger-strong
 * motion: the group bar's transform and the spinner (analysis-group-list.tsx); the chevron turns by transform;
 *   reduced motion: at once. The time left changes in place once a second while a step runs (text, not motion)
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { AssetDetail, TaalcutError } from '@taalcut/core';
import { Button, CONCEPT_ICONS, cn, ErrorLine, errorMessage, VERB_ICONS } from '@taalcut/ui';
import { ChevronDown } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { formatTimeLeft } from '../../../downloads/time-left';
import { indexingReasonText } from '../../indexing-messages';
import { analysisOf, type Analysis, type ModelWait } from '../clip-facts-data';
import { clipStageLabel, ClipStages } from '../clip-stages';
import { modelsForStages } from '../../../downloads/stage-models';
import { roundedLeftMs, timeLeftMs } from '../progress/analysis-estimate';
import { AnalysisGroupList } from '../progress/analysis-group-list';
import { analysisGroups, readinessOf } from '../progress/analysis-groups';
import { nowLine, readinessHeading } from '../progress/analysis-words';
import { useLiveProgress } from '../progress/use-live-progress';
import { ClipModels } from './clip-models';

/**
 * The fix for a failed step: `retry` runs the failed step again (it may pass next time); `reanalyse` analyses the
 * whole clip again from the start (the step can't pass as things are: worth it once the file is replaced or back).
 */
export type RetryKind = 'retry' | 'reanalyse';

export interface ClipStatusProps {
  detail: AssetDetail;
  onRetry?: (() => void) | undefined;
  retryKind?: RetryKind;
  retrying?: boolean;
  retryError?: TaalcutError | null;
}

/** The library's words for why a step failed; none when it has only the generic "something went wrong". */
function causeOf(i18n: I18n, error: TaalcutError | undefined): string | null {
  if (!error) return null;
  const cause = errorMessage(i18n, error);
  return cause === errorMessage(i18n, { ...error, messageKey: 'errors.core.unknown' }) ? null : cause;
}

function Steps({ detail }: { detail: AssetDetail }) {
  const { t } = useLingui();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
        data-slot="clip-steps-toggle"
        className="inline-flex cursor-pointer items-center gap-1 self-start rounded-sm type-label-sm text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:text-ink active:text-ink"
      >
        {open ? t`Hide the steps` : t`Show the steps`}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 transition-transform duration-(--dur-micro) ease-(--ease-out) motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div id={id} hidden={!open}>
        <ClipStages stages={detail.stages} />
      </div>
    </>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 id="clip-stages" className="m-0 type-card-title text-ink">
      {children}
    </h2>
  );
}

/** "Waiting for the speech and search models": which models, from the steps they hold, and the way out. */
function ModelsCard({ detail, models }: { detail: AssetDetail; models: ModelWait }) {
  const { i18n } = useLingui();
  const left = models.held.length + models.behind.length;
  return (
    <section
      aria-labelledby="clip-models-wait"
      data-slot="clip-models-card"
      data-phase="waitingForModels"
      className="flex flex-col gap-3 rounded-xl border border-rule bg-raised p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="clip-models-wait" className="m-0 type-card-title font-bold text-ink">
          {i18n._(modelsTitle(models))}
        </h2>
        <p className="m-0 type-body text-ink-2">
          <Plural
            value={left}
            one="One step starts by itself once they’re on this Mac."
            other="# steps start by themselves once they’re on this Mac."
          />
        </p>
      </div>
      <ClipModels ids={modelsForStages(detail.stages)} />
    </section>
  );
}

/**
 * "Waiting for the speech model", by which models the held steps need: speech, on-screen text, and search or the model
 * that describes clips (never both: a description held beside an embedding step waits for the search model).
 */
function modelsTitle({ speech, text, search, describe }: ModelWait): MessageDescriptor {
  if (describe) {
    if (speech && text)
      return msg`Waiting for the speech and on-screen text models, and the model that describes clips`;
    if (speech) return msg`Waiting for the speech model and the model that describes clips`;
    if (text) return msg`Waiting for the on-screen text model and the model that describes clips`;
    return msg`Waiting for the model that describes clips`;
  }
  if (speech && text && search) return msg`Waiting for the speech, on-screen text and search models`;
  if (speech && text) return msg`Waiting for the speech and on-screen text models`;
  if (text && search) return msg`Waiting for the on-screen text and search models`;
  if (speech && search) return msg`Waiting for the speech and search models`;
  if (text) return msg`Waiting for the on-screen text model`;
  return speech ? msg`Waiting for the speech model` : msg`Waiting for the search model`;
}

function Complete({ detail, analysis }: { detail: AssetDetail; analysis: Analysis }) {
  const { t } = useLingui();
  return (
    <section
      aria-labelledby="clip-stages"
      data-slot="clip-status"
      data-phase={analysis.phase}
      className="flex flex-col gap-1.5"
    >
      <h2 id="clip-stages" className="m-0 flex items-center gap-2 type-body text-ink-2">
        <CONCEPT_ICONS.success aria-hidden className="size-4 shrink-0 text-success-strong" />
        {t`Taalcut has looked at all of this clip`}
      </h2>
      <div className="flex flex-col ps-6">
        <Steps detail={detail} />
      </div>
    </section>
  );
}

export function ClipStatus({
  detail,
  onRetry,
  retryKind = 'retry',
  retrying = false,
  retryError = null,
}: ClipStatusProps) {
  const { t, i18n } = useLingui();
  const analysis = analysisOf(detail);
  const groups = useMemo(() => analysisGroups(detail), [detail]);
  const readiness = readinessOf(detail, groups);
  const clock = useLiveProgress(detail.stages);

  if (analysis.phase === 'complete') return <Complete detail={detail} analysis={analysis} />;

  if (analysis.phase === 'failed') {
    const stopped = analysis.failed ? clipStageLabel(i18n, analysis.failed.stage) : null;
    const cause = causeOf(i18n, analysis.failed?.error);
    return (
      <section
        aria-labelledby="clip-stages"
        data-slot="clip-status"
        data-phase="failed"
        className="flex flex-col gap-3"
      >
        <Heading>
          <span className="flex items-start gap-2">
            <CONCEPT_ICONS.error aria-hidden className="mt-1 size-4 shrink-0 text-danger-strong" />
            {t`Taalcut couldn’t finish looking at this clip`}
          </span>
        </Heading>
        <div className="flex flex-col items-start gap-2" data-slot="clip-failure">
          {stopped ? <p className="m-0 type-body text-ink-2">{t`Stopped at: ${stopped}`}</p> : null}
          {cause ? <p className="m-0 max-w-prose type-body text-ink">{cause}</p> : null}
          {onRetry ? (
            <Button
              size="sm"
              icon={VERB_ICONS.retry}
              loading={retrying}
              disabled={retrying}
              status={retryError ? 'error' : undefined}
              onClick={onRetry}
            >
              {retryKind === 'reanalyse' ? t`Analyse again` : t`Try again`}
            </Button>
          ) : null}
          {retryError ? <ErrorLine error={retryError} /> : null}
        </div>
        <AnalysisGroupList groups={groups} clock={clock} />
        <Steps detail={detail} />
      </section>
    );
  }

  const doing = nowLine(i18n, readiness);
  const leftMs = readiness.overall === 'running' ? timeLeftMs(detail.stages, clock) : null;
  const rounded = leftMs === null ? null : roundedLeftMs(leftMs);
  // Named as the import line's estimate, so its translations carry over.
  const left = rounded === null ? null : formatTimeLeft(i18n, rounded);
  const waiting =
    !doing && analysis.waitingFor ? (indexingReasonText(i18n, analysis.waitingFor) ?? null) : null;
  return (
    <>
      <section
        aria-labelledby="clip-stages"
        data-slot="clip-status"
        data-phase={analysis.phase}
        data-again={readiness.again || undefined}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <Heading>{readinessHeading(i18n, readiness)}</Heading>
          {doing || left ? (
            <p data-slot="clip-now" className="m-0 type-body text-ink-2">
              {doing}
              {doing && left ? ' ' : null}
              {left ? <span data-slot="clip-time-left">{t`About ${left} left`}</span> : null}
            </p>
          ) : null}
          {waiting ? <p className="m-0 type-body text-ink-2">{waiting}</p> : null}
          {readiness.again ? (
            <p data-slot="clip-again" className="m-0 type-meta text-ink-2">
              {t`What Taalcut found last time stays until each part is redone.`}
            </p>
          ) : null}
        </div>
        <AnalysisGroupList groups={groups} clock={clock} />
        <Steps detail={detail} />
      </section>
      {analysis.models ? <ModelsCard detail={detail} models={analysis.models} /> : null}
    </>
  );
}
