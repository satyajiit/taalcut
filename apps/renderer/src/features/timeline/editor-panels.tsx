// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, TimelineId } from '@taalcut/core';
import type { ComponentProps } from 'react';
import { BulkControls } from './bulk-controls';
import { InspectorComments } from './comments/inspector-comments';
import { CoverPanel } from './cover-panel';
import { EditorTaskPanel, type EditorTask } from './dock/editor-task';
import type { InspectorTool } from './editor-workspace-state';
import { Inspector } from './inspector';
import { MoreGallery } from './more/more-gallery';
import { NarrationPanel } from './narration-panel';
import type { Playhead } from './playhead';
import { PostCaptionTile } from './post-caption/post-caption-tile';
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
  /** The simple view's way back to its scenes; absent where the timeline is on screen. */
  onScenes?: (() => void) | undefined;
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
  onScenes,
  ...inspector
}: EditorPanelsProps) {
  const { timeline, model, edits, selection } = inspector;
  // MORE1: More is a gallery of tiles for a scene or for nothing selected; anything else selected (words, a
  // graphic, a stretch of time) keeps its own inspector. A designed video with nothing selected keeps its
  // design's inspector too, under the video's own tiles.
  const gallery = inspect === 'more' && (!selection || selection.kind === 'clip');
  const designed = !selection && !!timeline.authoredPrograms?.length;
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
              {gallery ? (
                <MoreGallery
                  timeline={timeline}
                  model={model}
                  selection={selection}
                  playhead={playhead}
                  edits={edits}
                  lookup={inspector.lookup}
                  videoOnly={designed}
                  comments={<InspectorComments compact selection={selection} timeline={timeline} />}
                  onSelect={inspector.onSelect}
                  onAddToChat={inspector.onAddToChat}
                  onVideo={onVideo}
                  onCover={onCover}
                  onScenes={onScenes}
                  videoTiles={<PostCaptionTile timeline={timeline} />}
                />
              ) : null}
              {!gallery || designed ? <Inspector {...inspector} tool={inspect} /> : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
