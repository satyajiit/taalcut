// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, TimelineId } from '@taalcut/core';
import type { ComponentProps } from 'react';
import { BulkControls } from './bulk-controls';
import { CoverPanel } from './cover-panel';
import { EditorTaskPanel, type EditorTask } from './dock/editor-task';
import type { InspectorTool } from './editor-workspace-state';
import { Inspector } from './inspector';
import { MoreActions } from './more-actions';
import { NarrationPanel } from './narration-panel';
import type { Playhead } from './playhead';
import { WordsPanel } from './words-panel';

interface EditorPanelsProps extends Omit<ComponentProps<typeof Inspector>, 'tool'> {
  projectId: ProjectId;
  playhead: Playhead;
  task: EditorTask | null;
  inspect: InspectorTool | null;
  coverOpened: boolean;
  cleanupOpened: boolean;
  selectedIds: ComponentProps<typeof BulkControls>['ids'];
  onCloseTask(): void;
  onCover(): void;
  onVideo(id: TimelineId): void;
}

/** One panel host keeps drafts alive while the detailed timeline stays available underneath. */
export function EditorPanels({
  projectId,
  playhead,
  task,
  inspect,
  coverOpened,
  cleanupOpened,
  selectedIds,
  onCloseTask,
  onCover,
  onVideo,
  ...inspector
}: EditorPanelsProps) {
  const { timeline, model, edits, selection } = inspector;
  const selectedClip =
    selection?.kind === 'clip' ? model.clips.find((view) => view.item.id === selection.clipId) : undefined;
  return (
    <>
      <div hidden={!!task || inspect !== 'sound'}>
        <NarrationPanel timeline={timeline} playhead={playhead} edits={edits} />
      </div>
      {coverOpened ? (
        <div hidden={!!task || inspect !== 'cover'} className="h-full overflow-y-auto">
          <CoverPanel timeline={timeline} playhead={playhead} paused={edits.pending} />
        </div>
      ) : null}
      {cleanupOpened ? (
        <div hidden={task !== 'cleanup'} className="h-full">
          <EditorTaskPanel task="cleanup" projectId={projectId} timeline={timeline} onClose={onCloseTask} />
        </div>
      ) : null}
      {task && task !== 'cleanup' ? (
        <EditorTaskPanel task={task} projectId={projectId} timeline={timeline} onClose={onCloseTask} />
      ) : !task && inspect && inspect !== 'cover' ? (
        <div className="min-w-0">
          {inspect === 'words' ? (
            <>
              {selection?.kind === 'item' && selection.itemKind === 'caption' ? (
                <Inspector {...inspector} tool="words" />
              ) : null}
              <WordsPanel timeline={timeline} playhead={playhead} edits={edits} />
            </>
          ) : inspect === 'adjust' ? (
            <BulkControls ids={selectedIds} model={model} edits={edits} />
          ) : (
            <>
              {inspect === 'more' && (!selection || selection.kind === 'clip') ? (
                <MoreActions
                  clip={selectedClip}
                  model={model}
                  playhead={playhead}
                  edits={edits}
                  onVideo={onVideo}
                  onCover={onCover}
                />
              ) : null}
              <Inspector {...inspector} tool={inspect} />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
