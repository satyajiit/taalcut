// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the editor shows, over core's contracts: the project (projects.get),
 * its timelines, one per variant (timelines.listByProject), the open one as
 * it changes (timelines.watch: the current document first, then each new
 * revision, so an edit, ⌘Z or the agent's change shows without asking), and
 * the template it was cut to (templates.get at the version it names), for
 * the slots' words.
 *
 * The reads run side by side (UX1): with `?timeline=` named (every link into
 * the editor names one), the watch opens with the project and the list rather
 * than after them; a name the list doesn't have falls back to its first video.
 * `retry` reads everything again and reopens the watch.
 */
import type { ProjectId, TaalcutError, TimelineId, TimelineSummary } from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { useTimelineDocument } from '../../backend/use-timeline-document';

/** Variants in their order ("Video 1 of 3"), then anything else by name. */
export function orderTimelines(list: readonly TimelineSummary[]): TimelineSummary[] {
  return [...list].sort(
    (a, b) => (a.variantIndex ?? 99) - (b.variantIndex ?? 99) || a.name.localeCompare(b.name),
  );
}

const isNotFound = (error: TaalcutError | undefined) => !!error && error.code.endsWith('not_found');

/**
 * The video to open: the one named while the list is on its way (so its watch starts at once), then the named
 * one if the list has it, else the list's first.
 */
export function pickActive(
  named: TimelineId | undefined,
  list: readonly TimelineSummary[] | undefined,
): TimelineId | undefined {
  if (!list) return named;
  return named && list.some((timeline) => timeline.id === named) ? named : list[0]?.id;
}

export function useEditorData(projectId: ProjectId, timelineId: TimelineId | undefined) {
  const backend = useBackend();
  const [attempt, setAttempt] = useState(0);
  const project = useRpcQuery(
    (signal) => backend.projects.get({ projectId }, { signal }),
    [backend, projectId, attempt],
  );
  const timelines = useRpcQuery(
    async (signal) => orderTimelines(await backend.timelines.listByProject({ projectId }, { signal })),
    [backend, projectId, attempt],
  );
  // A change re-reads the same project: reload() keeps the editor on screen while it does (a new input would be
  // `loading`, and the page would show its bones on every change).
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.projectId !== projectId) return;
    if (payload.entity === 'project' || (payload.entity === 'timeline' && payload.change !== 'updated')) {
      project.reload();
      timelines.reload();
    }
  });
  const list = timelines.data ?? [];
  const activeId = pickActive(timelineId, timelines.data);
  const doc = useTimelineDocument(activeId);
  const timeline = doc.data && doc.data.id === activeId ? doc.data : undefined;
  // A stale `?timeline=` that the list didn't have: its watch's "not found" belongs to the old name.
  const fellBack = timelines.data !== undefined && timelineId !== undefined && activeId !== timelineId;
  const timelineError = doc.error && !(fellBack && isNotFound(doc.error)) ? doc.error : undefined;
  const ref = timeline?.template ?? null;
  const template = useRpcQuery(
    async (signal) =>
      ref
        ? (await backend.templates.get({ templateId: ref.id, version: ref.version }, { signal })).template
        : null,
    [backend, ref?.id, ref?.version],
  );
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
    doc.reload();
  }, [doc.reload]);
  return {
    project,
    timelines,
    list,
    activeId,
    timeline,
    timelineError,
    reconnecting: !!timeline && doc.status !== 'ready',
    template: template.data ?? null,
    retry,
  };
}

export type EditorData = ReturnType<typeof useEditorData>;
