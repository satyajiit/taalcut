// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Projects the recovery report names after Taalcut closed unexpectedly
 * (P2-X3): the ones whose last committed commands it lists, and the ones
 * with background jobs it picked up again. Only after a crash: a backup
 * restore, an unfinished run or a reclaimed job. On an ordinary launch the
 * report still lists the last commands, and nothing is marked.
 */
import type { ProjectId, RecoveryReport } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useServices } from '../../services/provider';

export interface Recovered {
  /** The newest change kept, as a command name, and when; null when only a job came back. */
  readonly last: { readonly name: string; readonly at: number } | null;
}

export function recoveredProjects(report: RecoveryReport): ReadonlyMap<ProjectId, Recovered> {
  const crashed =
    report.restoredFromBackup !== null || report.unfinishedRuns.length > 0 || report.reclaimedJobs.length > 0;
  const marks = new Map<ProjectId, Recovered>();
  if (!crashed) return marks;
  for (const project of report.lastCommands) {
    if (!project.projectId) continue;
    const kept = project.commands.filter((command) => !command.undone);
    const newest = kept.reduce<(typeof kept)[number] | null>(
      (best, command) => (!best || command.sequence > best.sequence ? command : best),
      null,
    );
    marks.set(project.projectId, { last: newest ? { name: newest.name, at: newest.createdAt } : null });
  }
  for (const job of report.reclaimedJobs)
    if (job.projectId && !marks.has(job.projectId)) marks.set(job.projectId, { last: null });
  return marks;
}

/** This launch's recovered projects; empty until the report arrives, and when there was no crash. */
export function useRecoveredProjects(): ReadonlyMap<ProjectId, Recovered> {
  const { recovery } = useServices();
  const [marks, setMarks] = useState<ReadonlyMap<ProjectId, Recovered>>(() => new Map());
  useEffect(() => {
    let live = true;
    void recovery.report().then((result) => {
      if (live && result.ok) setMarks(recoveredProjects(result.value));
    });
    return () => {
      live = false;
    };
  }, [recovery]);
  return marks;
}
