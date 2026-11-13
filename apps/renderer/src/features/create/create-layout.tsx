// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · mode: Operate · system: DESIGN.md · stage context and responsive video summary; current, dirty, loading preview, empty brief. */

import { useLingui } from '@lingui/react/macro';
import { RationalTime, type CreationBrief, type CreationProject } from '@taalcut/core';
import { CONCEPT_ICONS, MediaError, PageSection, Segmented, UserContent, VERB_ICONS, cn } from '@taalcut/ui';
import { Notice } from '../settings/fields';
import { CreationPreview } from './create-preview';
import { CREATION_STATUS, CREATION_STEPS, STEP_WORDS, type CreationStep } from './create-words';

const STAGE_ICONS = {
  brief: CONCEPT_ICONS.request,
  research: CONCEPT_ICONS.search,
  script: CONCEPT_ICONS.text,
  design: CONCEPT_ICONS.brandKit,
  production: CONCEPT_ICONS.make,
};

const STATUS_ICONS = {
  draft: CONCEPT_ICONS.request,
  researching: CONCEPT_ICONS.running,
  'awaiting-approval': CONCEPT_ICONS.checks,
  producing: CONCEPT_ICONS.running,
  ready: CONCEPT_ICONS.success,
  failed: CONCEPT_ICONS.error,
  cancelled: VERB_ICONS.stop,
};

export function CreationState({ project, dirty }: { project: CreationProject; dirty: boolean }) {
  const { t, i18n } = useLingui();
  const Icon = STATUS_ICONS[project.status];
  const working = project.status === 'researching' || project.status === 'producing';
  return (
    <>
      <div role="status" className="flex items-center gap-2 type-body text-ink-2">
        <Icon
          aria-hidden
          className={cn(
            'size-4 shrink-0',
            working && 'animate-spin text-ai-strong',
            project.status === 'ready' && 'text-success-strong',
            project.status === 'failed' && 'text-danger-strong',
          )}
        />
        {i18n._(CREATION_STATUS[project.status])}
      </div>
      {project.error ? <MediaError error={project.error} /> : null}
      {dirty ? <Notice tone="info">{t`Save your changes before moving to the next stage.`}</Notice> : null}
    </>
  );
}

export function CreationStages({
  step,
  dirty,
  onStep,
}: {
  step: CreationStep;
  dirty: boolean;
  onStep: (step: CreationStep) => void;
}) {
  const { t, i18n } = useLingui();
  const stepNumber = i18n.number(CREATION_STEPS.indexOf(step) + 1);
  const stepCount = i18n.number(CREATION_STEPS.length);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-rule-subtle pb-5">
      <Segmented
        label={t`Creation workspace`}
        value={step}
        options={CREATION_STEPS.map((value) => {
          const Icon = STAGE_ICONS[value];
          return {
            value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Icon aria-hidden className="size-4 shrink-0" />
                {i18n._(STEP_WORDS[value])}
              </span>
            ),
            disabled: dirty && value !== step,
          };
        })}
        onChange={onStep}
      />
      <span className="type-meta text-ink-2">{t`Step ${stepNumber} of ${stepCount}`}</span>
    </div>
  );
}

export function CreationSummary({
  brief,
  project,
  showPreview = false,
}: {
  brief: CreationBrief;
  project?: CreationProject;
  showPreview?: boolean;
}) {
  const { t, i18n } = useLingui();
  const formats = new Intl.ListFormat(i18n.locale).format(brief.formats);
  const seconds = i18n.number(RationalTime.toSeconds(brief.duration), {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'long',
  });
  const voice =
    brief.voice.mode === 'none'
      ? t`No voiceover`
      : brief.voice.mode === 'connected'
        ? t`Generate a voiceover`
        : t`Use a recording`;
  return (
    <aside
      aria-label={t`Your video`}
      className="flex min-w-0 flex-col gap-6 border-t border-rule-subtle pt-6 xl:border-s xl:border-t-0 xl:ps-6 xl:pt-0"
    >
      {showPreview && project?.draft?.visualPreviewAssetId ? (
        <CreationPreview assetId={project.draft.visualPreviewAssetId} />
      ) : null}
      <PageSection title={t`Your video`} icon={CONCEPT_ICONS.project} level={3}>
        {brief.title.trim() ? (
          <UserContent className="block break-words type-section text-ink">{brief.title}</UserContent>
        ) : (
          <p className="m-0 type-body text-ink-2">{t`Your brief, story and finished video stay together here.`}</p>
        )}
        {brief.prompt.trim() ? (
          <UserContent className="block line-clamp-4 whitespace-pre-wrap break-words type-body text-ink-2">
            {brief.prompt}
          </UserContent>
        ) : null}
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 type-meta">
          <dt className="text-ink-2">{t`Target length`}</dt>
          <dd className="m-0 text-end text-ink">{seconds}</dd>
          <dt className="text-ink-2">{t`Output formats`}</dt>
          <dd className="m-0 text-end text-ink">{formats}</dd>
          <dt className="text-ink-2">{t`Voiceover`}</dt>
          <dd className="m-0 text-end text-ink">{voice}</dd>
          {project ? (
            <>
              <dt className="text-ink-2">{t`Sources`}</dt>
              <dd className="m-0 text-end text-ink">{i18n.number(project.sources.length)}</dd>
            </>
          ) : null}
        </dl>
      </PageSection>
      {brief.callToAction.trim() ? (
        <PageSection title={t`The next step for viewers`} icon={CONCEPT_ICONS.sharing} level={3}>
          <UserContent className="block break-words type-body text-ink-2">{brief.callToAction}</UserContent>
        </PageSection>
      ) : null}
    </aside>
  );
}
