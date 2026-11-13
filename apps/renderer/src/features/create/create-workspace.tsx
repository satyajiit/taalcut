// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, type CreationProject, type ProjectId } from '@taalcut/core';
import { Button, CONCEPT_ICONS, PageSection, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Page } from '../../shell/page';
import { LoadError, Loading, Notice } from '../settings/fields';
import { BriefFields } from './create-fields';
import { CreationResearch, CreationDraftEditor } from './create-review';
import { CreationSources } from './create-sources';
import { CreationProduction } from './create-production';
import { CreationStages, CreationState, CreationSummary } from './create-layout';
import { type CreationStep } from './create-words';

export function CreateWorkspace({
  projectId,
  step,
  onStep,
}: {
  projectId: ProjectId;
  step: CreationStep;
  onStep: (step: CreationStep) => void;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const [dirty, setDirty] = useState(false);
  const project = useRpcQuery(
    (signal) => backend.creation.get({ projectId }, { signal }),
    [backend, projectId],
  );
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('creation.') && payload.projectId === projectId) project.reload();
  });
  const running = project.data?.status === 'researching' || project.data?.status === 'producing';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(project.reload, 1500);
    return () => window.clearInterval(timer);
  }, [running, project.reload]);
  return (
    <Page
      title={t`Create`}
      detail={project.data ? <UserContent>{project.data.brief.title}</UserContent> : undefined}
      width="wide"
      actions={
        project.data?.timelineId ? (
          <Button asChild size="sm" icon={VERB_ICONS.open}>
            <Link
              to="/projects/$projectId/timeline"
              params={{ projectId }}
              search={{ timeline: project.data.timelineId }}
            >{t`Open editor`}</Link>
          </Button>
        ) : undefined
      }
    >
      <CreationStages step={step} dirty={dirty} onStep={onStep} />
      {project.status === 'loading' && !project.data ? <Loading /> : null}
      {project.status === 'error' ? (
        <LoadError error={project.error} onRetry={project.reload} what={t`This creation didn’t load.`} />
      ) : null}
      {project.data && !project.stale ? (
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <WorkspaceContent
              project={project.data}
              step={step}
              onStep={onStep}
              reload={project.reload}
              dirty={dirty}
              onDirty={setDirty}
            />
          </div>
          <CreationSummary
            brief={project.data.brief}
            project={project.data}
            showPreview={step === 'script' || step === 'design'}
          />
        </div>
      ) : null}
    </Page>
  );
}

function WorkspaceContent({
  project,
  step,
  onStep,
  reload,
  dirty,
  onDirty,
}: {
  project: CreationProject;
  step: CreationStep;
  onStep: (step: CreationStep) => void;
  reload: () => void;
  dirty: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useLingui();
  const command = useCommand();
  const running = project.status === 'researching' || project.status === 'producing';
  const target = { projectId: project.projectId, revision: project.revision };
  const run = async (name: string, extra: object = {}) => {
    const result = await command.run({ name, payload: { ...target, ...extra } });
    if (result.ok) reload();
    return result.ok;
  };
  const unanswered = project.draft?.questions.some(
    (question) => question.required && !question.answer?.trim(),
  );
  return (
    <>
      <CreationState project={project} dirty={dirty} />
      {step === 'brief' ? (
        <>
          <SavedBrief
            key={JSON.stringify(project.brief)}
            project={project}
            onChange={reload}
            onDirty={onDirty}
            disabled={running}
          />
          <CreationSources project={project} onChange={reload} disabled={running || dirty} />
          <Button
            variant="primary"
            icon={VERB_ICONS.readReel}
            className="self-start"
            disabled={running || dirty}
            loading={command.pending}
            onClick={async () => {
              onStep('research');
              await run(CREATION_COMMANDS.research);
            }}
          >{t`Research & draft script`}</Button>
        </>
      ) : step === 'research' ? (
        <>
          <CreationResearch
            key={project.draft?.revision ?? project.projectId}
            project={project}
            onChange={reload}
          />
          {project.draft?.answersPending ? (
            <Button
              className="self-start"
              icon={VERB_ICONS.readReel}
              disabled={running}
              loading={command.pending}
              onClick={() => void run(CREATION_COMMANDS.research)}
            >{t`Research & draft script`}</Button>
          ) : null}
          {project.draft ? (
            <Button
              className="self-start"
              icon={VERB_ICONS.next}
              iconPlacement="end"
              disabled={running || project.draft.answersPending}
              onClick={() => onStep('script')}
            >{t`Review script`}</Button>
          ) : null}
        </>
      ) : step === 'script' || step === 'design' ? (
        <>
          <CreationDraftEditor
            key={`${step}-${project.draft?.revision}-${project.draft?.visualPreviewAssetId}`}
            project={project}
            design={step === 'design'}
            onChange={reload}
            onDirty={onDirty}
          />
          {step === 'script' ? (
            <Button
              className="self-start"
              icon={VERB_ICONS.next}
              iconPlacement="end"
              disabled={dirty}
              onClick={() => onStep('design')}
            >{t`Review visual direction`}</Button>
          ) : project.draft ? (
            <>
              {unanswered ? (
                <Notice tone="info">{t`Answer the required research questions before approving this draft.`}</Notice>
              ) : null}
              {!project.draft.visualPreviewAssetId ? (
                <Button
                  className="self-start"
                  icon={VERB_ICONS.checkAgain}
                  disabled={running || dirty}
                  loading={command.pending}
                  onClick={() => void run(CREATION_COMMANDS.research)}
                >{t`Refresh visual preview`}</Button>
              ) : null}
              <Button
                variant="primary"
                icon={VERB_ICONS.approve}
                className="self-start"
                disabled={
                  running ||
                  dirty ||
                  unanswered ||
                  project.draft.answersPending ||
                  !project.draft.visualPreviewAssetId ||
                  project.approvedDraftRevision === project.draft.revision
                }
                loading={command.pending}
                onClick={async () => {
                  if (await run(CREATION_COMMANDS.approve, { draftRevision: project.draft?.revision }))
                    onStep('production');
                }}
              >{t`Approve script & design`}</Button>
            </>
          ) : null}
        </>
      ) : (
        <CreationProduction project={project} onChange={reload} />
      )}
      {running ? (
        <Button
          variant="ghost"
          className="self-start"
          icon={VERB_ICONS.stop}
          onClick={() => void run(CREATION_COMMANDS.cancel)}
        >{t`Stop work`}</Button>
      ) : null}
    </>
  );
}

function SavedBrief({
  project,
  onChange,
  disabled,
  onDirty,
}: {
  project: CreationProject;
  onChange: () => void;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useLingui();
  const command = useCommand();
  const [brief, setBrief] = useState(project.brief);
  const dirty = JSON.stringify(brief) !== JSON.stringify(project.brief);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await command.run({
          name: CREATION_COMMANDS.updateBrief,
          payload: { projectId: project.projectId, revision: project.revision, brief },
        });
        if (result.ok) onChange();
      }}
    >
      <PageSection title={t`Tell the story`} icon={CONCEPT_ICONS.request}>
        <BriefFields value={brief} onChange={setBrief} disabled={disabled || command.pending} />
      </PageSection>
      <Button
        type="submit"
        icon={VERB_ICONS.approve}
        className="self-start"
        disabled={disabled || !brief.title.trim()}
        loading={command.pending}
      >{t`Save brief`}</Button>
    </form>
  );
}
