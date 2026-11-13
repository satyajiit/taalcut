// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · editor · DESIGN.md
 * A persistent chat beside the canvas, scene selection and common actions below it.
 * Detailed tracks and task panels share the lower work area. AI ownership pauses
 * document mutations; playback, seeking and selection stay available. */
import { useLingui } from '@lingui/react/macro';
import { newId, type CastId, type ProjectId, type TimelineId, type TimelineItemId } from '@taalcut/core';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useComposerRequest, useSelections } from '../../chat/selection-store';
import { useProjectHistory } from '../../shell/current-project';
import { useDocumentTitle } from '../../shell/page';
import { TimelineEmpty } from '../make/make-empty';
import { EditorDock, type DockPanel } from './dock/editor-dock';
import { EditorBones } from './editor-bones';
import type { EditorPanel } from './editor-context';
import { EditorFailed, ProjectGone } from './editor-messages';
import { cleanupAvailable } from './cleanup/cleanup-panel';
import { useClaim } from './comments/comment-requests';
import { useCommentsDock } from './comments/use-comments-dock';
import { useChatSendDock } from './dock/chat-requests';
import { filesRequests } from './workspace/files-requests';
import { EditorToolbar } from './editor-toolbar';
import { useEditorData } from './use-editor-data';
import { CompareView } from './variants/compare-view';
import { Editor } from './editor';

export type { EditorPanel } from './editor-context';

export interface TimelineSearch {
  timeline?: TimelineId | undefined;
  clip?: TimelineItemId | undefined;
  export?: true | undefined;
  /** P3-V3: the variants of one cast side by side, instead of the editor. */
  compare?: CastId | undefined;
  /** P3-V9, P3-V12, P3-B8: a panel opened from a card or ⌘K. */
  panel?: EditorPanel | undefined;
}

export interface TimelinePageProps {
  projectId: ProjectId;
  search: TimelineSearch;
  onSearch: (next: TimelineSearch) => void;
}

// The export dialog (features/renders) loads when "Export…" opens it.
const ExportDialog = lazy(async () => ({ default: (await import('../renders/export-dialog')).ExportDialog }));

const isNotFound = (code: string | undefined) => !!code && code.endsWith('not_found');

export function TimelinePage({ projectId, search, onSearch }: TimelinePageProps) {
  const { t } = useLingui();
  useDocumentTitle(t`Make`);
  useProjectHistory(projectId);
  const data = useEditorData(projectId, search.timeline);
  const { project, timelines, list, activeId, timeline, template } = data;
  const [docked, setDocked] = useState<{ projectId: ProjectId; panel: DockPanel | null } | null>(null);
  const dock = docked?.projectId === projectId ? docked.panel : null;
  const setDock = (panel: DockPanel | null) => setDocked({ projectId, panel });
  // A project nobody wrote to yet: one new conversation for as long as the page is open (stored with its first message).
  const [newChat] = useState(() => newId<'Conversation'>());
  const chatId = project.data ? (project.data.conversationId ?? newChat) : undefined;

  // "Add to chat" and a card's "Ask about…" show the chat they went to.
  const added = useSelections().length;
  const before = useRef(added);
  useEffect(() => {
    if (added > before.current) setDock('chat');
    before.current = added;
  }, [added]);
  const request = useComposerRequest();
  const seen = useRef(request?.tick ?? 0);
  useEffect(() => {
    if (request && request.tick > seen.current) setDock('chat');
    seen.current = request?.tick ?? 0;
  }, [request]);

  // EDT1-CMT: a pin or a comment's count opens the dock on Comments.
  useCommentsDock(setDock);
  // HFW1-UI: a View files opens it on Files; a request for the chat (Try again in the inspector) on Chat.
  useClaim(filesRequests, () => setDock('files'));
  useChatSendDock(setDock);

  // A cleanup plan's "Open in the editor" (`?panel=cleanup`) opens the dock on Clean up once the cut can take it.
  const wantsCleanup = search.panel === 'cleanup' && cleanupAvailable(timeline ?? null);
  useEffect(() => {
    if (wantsCleanup) setDock('cleanup');
  }, [wantsCleanup]);

  const gone = isNotFound(project.error?.code);
  const loading = project.status === 'loading' || timelines.status === 'loading';
  let body;
  if (gone) body = <ProjectGone />;
  else if (project.status === 'error' && !project.data)
    body = <EditorFailed what="project" error={project.error} onRetry={data.retry} />;
  else if (timelines.status === 'error' && !timelines.data)
    body = <EditorFailed what="videos" error={timelines.error} onRetry={data.retry} />;
  else if (loading) body = <EditorBones />;
  else if (list.length === 0) body = <TimelineEmpty />;
  else if (data.timelineError && !timeline)
    body = <EditorFailed what="video" error={data.timelineError} onRetry={data.retry} />;
  else if (search.compare)
    body = (
      <CompareView
        projectId={projectId}
        castId={search.compare}
        onClose={() => onSearch({ compare: undefined })}
      />
    );
  else if (!timeline) body = <EditorBones />;
  else
    body = (
      <Editor
        key={timeline.id}
        projectId={projectId}
        timeline={timeline}
        template={template}
        task={dock && dock !== 'chat' ? dock : null}
        onCloseTask={() => setDock(null)}
        onVideo={(timeline) => onSearch({ timeline, clip: undefined })}
        clip={search.clip}
        onClip={(clip) => {
          if (clip !== search.clip) onSearch({ clip });
        }}
        panel={search.panel}
        onPanel={(panel) => onSearch({ panel })}
      />
    );

  return (
    <div data-slot="timeline-page" className="absolute inset-0 flex overflow-hidden">
      <EditorToolbar
        projectId={projectId}
        timeline={timeline ?? null}
        name={project.data?.name}
        videos={list}
        activeId={activeId}
        // Picking a video opens it in the editor, out of the compare view.
        onPickVideo={(id) => onSearch({ timeline: id, clip: undefined, compare: undefined })}
        dock={dock}
        onDock={setDock}
        canExport={!!timeline && timeline.tracks.some((track) => track.items.length > 0)}
        onExport={() => onSearch({ export: true })}
        hideExport={!!search.compare}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {data.reconnecting ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-rule bg-sunken px-3 py-1 type-meta"
          >
            {t`Reconnecting to your video… Last saved view is still visible.`}
            <Button size="sm" variant="ghost" icon={VERB_ICONS.retry} onClick={data.retry}>
              {t`Try again`}
            </Button>
          </div>
        ) : null}
        {body}
      </div>
      {!gone ? <EditorDock conversationId={chatId} /> : null}
      {activeId && search.export ? (
        <Suspense fallback={null}>
          <ExportDialog
            projectId={projectId}
            timelineId={activeId}
            open
            onOpenChange={(open) => {
              if (!open) onSearch({ export: undefined });
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
