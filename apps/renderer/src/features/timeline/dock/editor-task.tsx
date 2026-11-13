// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { ProjectId, Timeline } from '@taalcut/core';
import { Button, SkeletonLines, VERB_ICONS } from '@taalcut/ui';
import { lazy, Suspense } from 'react';
import { CleanupPanel } from '../cleanup/cleanup-panel';
import { CommentsPanel } from '../comments/comments-panel';
import { useLatest } from '../comments/comment-requests';
import { LookMenu } from '../look/look-menu';
import { FilesPanel } from '../workspace/files-panel';
import { filesRequests } from '../workspace/files-requests';
import type { DockPanel } from './editor-dock';

const VersionsPanel = lazy(async () => ({
  default: (await import('../../make/versions-panel')).VersionsPanel,
}));
export type EditorTask = Exclude<DockPanel, 'chat'>;

export function EditorTaskPanel({
  task,
  projectId,
  timeline,
  onClose,
}: {
  task: EditorTask;
  projectId: ProjectId;
  timeline: Timeline;
  onClose(): void;
}) {
  const { t } = useLingui();
  const request = useLatest(filesRequests)?.value ?? null;
  const names: Record<EditorTask, string> = {
    versions: t`Versions`,
    cleanup: t`Clean up`,
    comments: t`Comments`,
    files: t`Files`,
    look: t`Look`,
  };
  return (
    <section aria-label={names[task]} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-rule-subtle px-3 py-1">
        <h2 className="m-0 type-section-title">{names[task]}</h2>
        <Button
          size="sm"
          variant="ghost"
          icon={VERB_ICONS.close}
          onClick={onClose}
        >{t`Back to scenes`}</Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {task === 'comments' ? (
          <CommentsPanel timeline={timeline} />
        ) : task === 'files' ? (
          <FilesPanel projectId={projectId} timeline={timeline} request={request} />
        ) : task === 'cleanup' ? (
          <CleanupPanel projectId={projectId} timeline={timeline} />
        ) : task === 'look' ? (
          <div className="p-4">
            <LookMenu target={{ kind: 'timeline', projectId, timeline }} />
          </div>
        ) : (
          <Suspense fallback={<SkeletonLines lines={4} className="p-4" />}>
            <VersionsPanel projectId={projectId} timelineId={timeline.id} onClose={onClose} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
