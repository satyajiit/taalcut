// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { parseId, type ProjectId, type Timeline, type TimelineId } from '@taalcut/core';
import { toast } from '@taalcut/ui';
import type { useNavigate } from '@tanstack/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import { currentProject } from '../../shell/current-project';
import type { Playhead } from './playhead';

interface PreparedNarration {
  projectId: ProjectId;
  timelineId: TimelineId;
  revision: number;
  frame: number;
}
let pending: PreparedNarration | null = null;
const listeners = new Set<() => void>();
function publish(value: PreparedNarration | null) {
  pending = value;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A broadcast must not move another project's window or bring any window to the foreground. */
export function prepareNarrationNavigation(
  navigate: ReturnType<typeof useNavigate>,
  args: Record<string, string> | undefined,
  project = currentProject(),
): boolean {
  const projectId = parseId<'Project'>(args?.projectId);
  const timelineId = parseId<'Timeline'>(args?.timelineId);
  const revision = Number(args?.revision),
    frame = Number(args?.frame);
  if (
    !projectId.ok ||
    project !== projectId.value ||
    !timelineId.ok ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(frame) ||
    frame < 0
  )
    return false;
  publish({ projectId: projectId.value, timelineId: timelineId.value, revision, frame });
  void navigate({
    to: '/projects/$projectId/timeline',
    params: { projectId: projectId.value },
    search: { timeline: timelineId.value },
  });
  return true;
}

/** Preparing only opens Sound and seeks. The recorder's Record button remains the sole microphone entry. */
export function usePreparedNarration(timeline: Timeline, playhead: Playhead, open: () => void) {
  const { t } = useLingui();
  const request = useSyncExternalStore(subscribe, () => pending);
  useEffect(() => {
    if (!request || request.projectId !== timeline.projectId || request.timelineId !== timeline.id) return;
    if (timeline.revision < request.revision) return;
    publish(null);
    if (timeline.revision !== request.revision || request.frame >= playhead.total() - 1) {
      toast({ tone: 'warning', title: t`The video changed. Ask Taalcut to prepare the recorder again.` });
      return;
    }
    playhead.pause();
    playhead.seek(request.frame);
    open();
  }, [request, timeline.id, timeline.projectId, timeline.revision, playhead, open, t]);
}
