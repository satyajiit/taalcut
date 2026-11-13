// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · mode: Operate · system: DESIGN.md · production work and recovery.
 * States: approved, working, ready, failed, stopped; Kaatu respects reduced motion and Show Kaatu. */

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, type CreationProject, type CreationTask } from '@taalcut/core';
import { Button, Collapse, CONCEPT_ICONS, KaatuMoment, PageSection, VERB_ICONS, cn } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useCommand } from '../../backend/use-command';
import { Notice } from '../settings/fields';
import { TASK_ROLES, TASK_STATUS, TASK_ACTIVITY } from './create-words';

const TASK_ICONS = {
  queued: CONCEPT_ICONS.waiting,
  running: CONCEPT_ICONS.running,
  completed: CONCEPT_ICONS.success,
  failed: CONCEPT_ICONS.error,
  cancelled: VERB_ICONS.stop,
} satisfies Record<CreationTask['status'], typeof CONCEPT_ICONS.success>;

export function CreationProduction({
  project,
  onChange,
}: {
  project: CreationProject;
  onChange: () => void;
}) {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const approved = !!project.draft && project.approvedDraftRevision === project.draft.revision;
  const resumable = project.status === 'failed' || project.status === 'cancelled';
  const charged = project.error?.code === 'agent.creation_interrupted_charge';
  return (
    <PageSection title={t`Production`} icon={CONCEPT_ICONS.make}>
      {project.status === 'producing' || project.status === 'ready' || project.status === 'failed' ? (
        <KaatuMoment
          tone={project.status === 'producing' ? 'wait' : project.status === 'ready' ? 'success' : 'failure'}
        >
          {project.status === 'producing'
            ? t`Your approved story is becoming a video. You can follow the work here.`
            : project.status === 'ready'
              ? t`Your video is ready. Open the editor to make it yours.`
              : t`Creation needs attention. Review the error before continuing.`}
        </KaatuMoment>
      ) : (
        <p className="m-0 max-w-prose type-body text-ink-2">{t`The director coordinates research, script, design, voice and review. Your sources and approved draft stay together in this workspace.`}</p>
      )}

      {project.timelineId ? (
        <Button asChild variant="primary" className="self-start" icon={VERB_ICONS.open}>
          <Link
            to="/projects/$projectId/timeline"
            params={{ projectId: project.projectId }}
            search={{ timeline: project.timelineId }}
          >{t`Open editor`}</Link>
        </Button>
      ) : null}
      {!approved ? (
        <Notice tone="info">{t`Approve the current script and visual direction to create your video.`}</Notice>
      ) : null}
      {charged ? (
        <Notice tone="info">{t`The previous provider call may have been charged. Retrying can create another charge.`}</Notice>
      ) : null}
      {(approved || resumable) && project.status !== 'producing' && project.status !== 'ready' ? (
        <Button
          variant="primary"
          icon={charged || resumable ? VERB_ICONS.retry : VERB_ICONS.makeVideo}
          className="self-start"
          loading={command.pending}
          onClick={async () => {
            const result = await command.run({
              name: charged
                ? CREATION_COMMANDS.retry
                : resumable
                  ? CREATION_COMMANDS.resume
                  : CREATION_COMMANDS.produce,
              payload: { projectId: project.projectId, revision: project.revision },
            });
            if (result.ok) onChange();
          }}
        >
          {charged ? t`Retry paid work` : resumable ? t`Resume creation` : t`Create video`}
        </Button>
      ) : null}

      {project.tasks.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-4">
          {project.status === 'ready' ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              icon={CONCEPT_ICONS.job}
              aria-expanded={showDetails}
              aria-controls={detailsId}
              onClick={() => setShowDetails((shown) => !shown)}
            >
              {showDetails ? t`Hide production details` : t`Show production details`}
            </Button>
          ) : null}
          <Collapse id={detailsId} open={project.status !== 'ready' || showDetails}>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {project.tasks.map((task) => {
                const Icon = TASK_ICONS[task.status];
                return (
                  <li
                    key={task.id}
                    className="flex items-start gap-3 border-b border-rule-subtle pb-4 last:border-0 last:pb-0"
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        'mt-1 size-4 shrink-0 text-ink-3',
                        task.status === 'running' && 'animate-spin text-ai-strong',
                        task.status === 'completed' && 'text-success-strong',
                        task.status === 'failed' && 'text-danger-strong',
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="type-label text-ink">{i18n._(TASK_ROLES[task.role])}</span>
                      <span className="type-body text-ink-2">{i18n._(TASK_ACTIVITY[task.role])}</span>
                      <span className="type-meta text-ink-2">{i18n._(TASK_STATUS[task.status])}</span>
                      {task.status === 'running' ? (
                        <progress
                          className="h-1 w-full accent-current text-ai-strong"
                          aria-label={i18n._(TASK_ROLES[task.role])}
                          max={1}
                          value={task.progress}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Collapse>
        </div>
      ) : null}
    </PageSection>
  );
}
