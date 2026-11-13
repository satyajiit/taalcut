// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the recovery report in full (P1-D5; UX4 type roles) · system: DESIGN.md v0.7 + design-type.md
 * what View details opens in the recovery prompt: a sunken panel of short sections (each an h3 in the card-title
 *   role), times as Intl's words, paths and ids in the mono face at the meta size, never below 12 px.
 * states: n/a (text)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { UserContent, useFormatters } from '@taalcut/ui';
import { Fragment, type ReactNode } from 'react';
import type { RecoveryReport } from '@taalcut/core';
import { commandLabel, jobKindLabel } from './labels';

/** Ids (job kinds, command names) only in developer builds; people get the words. */
const DEVELOPER = import.meta.env.DEV;

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 type-card-title text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** When something happened: Intl's words in a <time>, as every Intl-formatted moment is (data, never translated). */
export function Moment({ at, className }: { at: number; className?: string }) {
  const format = useFormatters();
  return (
    <time dateTime={new Date(at).toISOString()} className={className}>
      {format.dateTime(at)}
    </time>
  );
}

/** An id, for developers: as it is, in the mono face. */
function Code({ children }: { children: string }) {
  return (
    <code className="type-meta font-mono text-ink-3">
      <UserContent>{children}</UserContent>
    </code>
  );
}

/** A file's path, as it is, breaking only after a slash (never inside a name or a number). */
function Path({ children }: { children: string }) {
  const parts = children.split('/');
  return (
    <code className="type-meta font-mono text-ink-2 [overflow-wrap:anywhere]">
      <UserContent className="whitespace-normal">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part}
            {i < parts.length - 1 ? (
              <>
                /<wbr />
              </>
            ) : null}
          </Fragment>
        ))}
      </UserContent>
    </code>
  );
}

/** The recovery report in full: what "View details" opens. */
export function RecoveryDetails({ report }: { report: RecoveryReport }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const backup = report.restoredFromBackup;
  const savedAt = backup ? <Moment at={backup.restoredFrom.createdAt} /> : null;
  return (
    <div
      data-slot="recovery-details"
      className="flex flex-col gap-4 rounded-lg bg-panel p-4 type-body text-ink"
    >
      {backup ? (
        <Section title={<Trans>Restored backup</Trans>}>
          <p className="m-0">
            <Trans>Saved {savedAt}</Trans>
          </p>
          <Path>{backup.restoredFrom.path}</Path>
          {backup.quarantinedPath ? (
            <>
              <p className="m-0 text-ink-2">
                <Trans>The damaged file was kept here, in case you need it:</Trans>
              </p>
              <Path>{backup.quarantinedPath}</Path>
            </>
          ) : null}
        </Section>
      ) : null}
      {report.unfinishedRuns.length > 0 ? (
        <Section title={<Trans>Unfinished agent tasks</Trans>}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {report.unfinishedRuns.map((run) => {
              const started = <Moment at={run.startedAt} />;
              const active = <Moment at={run.updatedAt} />;
              return (
                <li key={run.runId}>
                  <Trans>
                    Started {started}, last active {active}
                  </Trans>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      {report.reclaimedJobs.length > 0 ? (
        <Section title={<Trans>Background jobs</Trans>}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {report.reclaimedJobs.map((job) => {
              const done = job.progress === null ? null : format.percent(job.progress);
              return (
                <li key={job.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{jobKindLabel(i18n, job.kind)}</span>
                  <span className="text-ink-2">
                    {job.state === 'failed'
                      ? t`Couldn't restart`
                      : done === null
                        ? t`Will run again`
                        : t`Will continue from ${done}`}
                  </span>
                  {DEVELOPER ? <Code>{job.kind}</Code> : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      {report.lastCommands.length > 0 ? (
        <Section title={<Trans>Your last saved changes</Trans>}>
          {report.lastCommands.map((project) => (
            <div key={project.projectId ?? 'app'} className="flex flex-col gap-1">
              <p className="m-0 type-label">
                {project.projectName ? <UserContent>{project.projectName}</UserContent> : t`App settings`}
              </p>
              <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
                {project.commands.map((command) => (
                  <li key={command.id} className="flex flex-wrap items-baseline gap-x-2">
                    <Moment at={command.createdAt} className="type-meta text-ink-3" />
                    <span>{commandLabel(i18n, command.name)}</span>
                    {DEVELOPER ? <Code>{command.name}</Code> : null}
                    {command.undone ? <span className="type-meta text-ink-3">{t`Undone`}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Section>
      ) : null}
    </div>
  );
}
