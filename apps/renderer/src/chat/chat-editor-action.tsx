// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { ProjectId, TimelineId } from '@taalcut/core';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useBackend } from '../backend/backend';
import { useBackendEvents } from '../backend/use-events';
import { useRpcQuery } from '../backend/use-rpc';
import { orderTimelines, pickActive } from '../features/timeline/use-editor-data';
import { VideoSwitcher } from '../features/timeline/video-switcher';
import { ToolbarActions } from '../shell/toolbar';
import { navigateCardLink } from './card-links';
import type { TranscriptItem } from './transcript';

function findLatestEditTarget(items: readonly TranscriptItem[]): {
  projectId?: ProjectId;
  timelineId?: TimelineId;
} {
  let projectId: ProjectId | undefined;
  let timelineId: TimelineId | undefined;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || item.kind !== 'card') continue;
    const card = item.card as Record<string, unknown>;
    if (!projectId && typeof card.projectId === 'string') {
      projectId = card.projectId as ProjectId;
    }
    if (!timelineId) {
      if (typeof card.timelineId === 'string') {
        timelineId = card.timelineId as TimelineId;
      } else if (Array.isArray(card.timelineIds) && typeof card.timelineIds[0] === 'string') {
        timelineId = card.timelineIds[0] as TimelineId;
      } else if (
        Array.isArray(card.variants) &&
        card.variants[0] &&
        typeof (card.variants[0] as { timelineId?: unknown }).timelineId === 'string'
      ) {
        timelineId = (card.variants[0] as { timelineId: TimelineId }).timelineId;
      }
    }
    if (projectId && timelineId) break;
  }
  return {
    ...(projectId ? { projectId } : {}),
    ...(timelineId ? { timelineId } : {}),
  };
}

/**
 * Shows an "Open editor" button (and the video switcher when multiple variants exist)
 * in the chat page's window toolbar whenever the conversation has an assembled video cut.
 */
export function ChatEditorAction({
  projectId: conversationProjectId,
  items,
}: {
  projectId?: ProjectId | null | undefined;
  items: readonly TranscriptItem[];
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const backend = useBackend();
  const fromCards = useMemo(() => findLatestEditTarget(items), [items]);
  const projectId = conversationProjectId ?? fromCards.projectId;

  const timelines = useRpcQuery(
    async (signal) =>
      projectId ? orderTimelines(await backend.timelines.listByProject({ projectId }, { signal })) : [],
    [backend, projectId],
  );

  useBackendEvents(['library.changed'], ({ payload }) => {
    if (!projectId || payload.projectId !== projectId) return;
    if (payload.entity === 'timeline' || payload.entity === 'project') {
      timelines.reload();
    }
  });

  const list = timelines.data ?? [];
  const activeId = pickActive(fromCards.timelineId, timelines.data);
  const hasVideoEdit = Boolean(projectId && (list.length > 0 || fromCards.timelineId));

  if (!projectId || !hasVideoEdit) return null;

  const openEditor = (targetTimelineId?: TimelineId) => {
    navigateCardLink(navigate, {
      to: 'timeline',
      projectId,
      ...(targetTimelineId ? { timelineId: targetTimelineId } : {}),
    });
  };

  return (
    <ToolbarActions>
      <div className="flex items-center gap-1.5" data-slot="chat-editor-actions">
        {list.length > 1 && activeId ? (
          <VideoSwitcher videos={list} activeId={activeId} onPick={(id) => openEditor(id)} />
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          data-slot="open-editor"
          icon={VERB_ICONS.open}
          onClick={() => openEditor(activeId)}
        >
          {t`Open editor`}
        </Button>
      </div>
    </ToolbarActions>
  );
}
