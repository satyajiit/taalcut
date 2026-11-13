// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · system: DESIGN.md v0.7 · selected-item tools beside the viewer; timeline stays visible. */
import { useLingui } from '@lingui/react/macro';
import type {
  EditItemTarget,
  Clip,
  ProjectId,
  Template,
  Timeline,
  TimelineId,
  TimelineItemId,
} from '@taalcut/core';
import { Button, ErrorLine, toast, type PreviewPlayerHandle } from '@taalcut/ui';
import { useEffect, useMemo, useRef, useState, useReducer } from 'react';
import { addCurrentSelection } from '../../chat/selection-store';
import { EditorContextProvider, type EditorPanel } from './editor-context';
import { EditorComments } from './comments/editor-comments';
import { CommentViewerMarker } from './comments/comment-viewer-marker';
import type { EditorTask } from './dock/editor-task';
import { EditorPanels } from './editor-panels';
import { editorWorkspaceReducer, type InspectorTool } from './editor-workspace-state';
import { buildModel, mediaOf, type ClipView } from './model';
import { usePlayhead } from './playhead';
import { ViewerHost } from './preview/viewer-host';
import { SceneStrip } from './scene-strip';
import { useShotLookup, useTimelineShots } from './shot-frames';
import { TimelineBed } from './timeline-bed';
import { EditTools } from './edit-tools';
import { Transport, ZOOMS } from './transport';
import { useEditorKeys } from './use-editor-keys';
import { useEditorSelection } from './use-editor-selection';
import { useEdits } from './use-edits';
import { usePreparedNarration } from './narration-preparation';
import { useMultiSelection } from './multi-selection';
import { useProjectUndo } from './use-project-undo';
import { useEditorActivity } from './use-editor-activity';
import { useAiEditMarks } from './ai-edit-marks';

const VIEWER_FRAME = { width: 540, height: 960 } as const;
interface EditorProps {
  projectId: ProjectId;
  timeline: Timeline;
  template: Template | null;
  clip: TimelineItemId | undefined;
  onClip: (clip: TimelineItemId | undefined) => void;
  panel: EditorPanel | undefined;
  onPanel: (panel: EditorPanel | undefined) => void;
  task: EditorTask | null;
  onCloseTask(): void;
  onVideo(id: TimelineId): void;
}

export function Editor({
  projectId,
  timeline,
  template,
  clip,
  onClip,
  panel,
  onPanel,
  task,
  onCloseTask,
  onVideo,
}: EditorProps) {
  const { t, i18n } = useLingui();
  const model = useMemo(() => buildModel(timeline, template), [timeline, template]);
  const playhead = usePlayhead();
  const handle = useRef<PreviewPlayerHandle | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lookup = useShotLookup();
  // Re-renders as the clips' pictures arrive, so the viewer and the clips draw them.
  useTimelineShots(timeline, lookup);
  const activity = useEditorActivity(projectId);
  const history = useProjectUndo(projectId);
  const aiMarks = useAiEditMarks(timeline, activity.data);
  const mutations = useEdits(projectId, timeline.id, model);
  const edits = { ...mutations, pending: mutations.pending || activity.paused };
  const [coverOpened, setCoverOpened] = useState(false);
  const [cleanupOpened, setCleanupOpened] = useState(task === 'cleanup');
  useEffect(() => {
    if (task === 'cleanup') setCleanupOpened(true);
  }, [task]);
  const authored = !!timeline.authoredPrograms?.length;
  const [workspace, dispatchView] = useReducer(editorWorkspaceReducer, {
    detailed: authored,
    inspector: authored ? 'more' : null,
    textEditRequest: null,
  });
  const { detailed, inspector: inspect, textEditRequest } = workspace;
  const setInspect = (tool: InspectorTool | null) => dispatchView({ type: 'inspect', tool });
  const multi = useMultiSelection(model.clips.map((view) => view.item.id));
  useEffect(() => {
    if (clip && !multi.selected.includes(clip)) multi.pick(clip);
  }, [clip]);
  const [zoomIndex, setZoomIndex] = useState(0);
  // Pixels per frame as the bed drew them, for the part of it in view.
  const scale = useRef(0);
  const { selection, select, selectTarget } = useEditorSelection({
    projectId,
    timeline,
    model,
    playhead,
    clip,
    onClip,
    scroller,
    scale,
    onFocus: (target) => {
      if (target.kind !== 'item' || !['text', 'graphic', 'caption'].includes(target.itemKind)) return;
      onCloseTask();
      dispatchView({ type: 'edit-text', target });
    },
  });

  // The playhead knows the film's length before the viewer says so.
  useEffect(() => playhead.setFilm(model.total, model.rate.num / model.rate.den), [model, playhead]);
  usePreparedNarration(timeline, playhead, () => {
    onCloseTask();
    setInspect('sound');
  });

  const zoom = (index: number) => setZoomIndex(Math.min(ZOOMS.length - 1, Math.max(0, index)));
  useEditorKeys({
    togglePlay: () => playhead.toggle(),
    zoom: (step) => zoom(zoomIndex + step),
    fit: () => zoom(0),
    deselect: () => {
      select(null);
      multi.clear();
    },
  });

  const addToChat = () => {
    const outcome = addCurrentSelection();
    if (outcome === 'full') toast({ tone: 'warning', title: t`A message can point at 20 things at most` });
  };

  const pictureFor = (view: ClipView) => {
    const media = mediaOf(view.item);
    return lookup.frameNow(media.assetId, media.shotId)?.url ?? null;
  };
  const frameUrl = (item: Clip) => {
    const media = mediaOf(item);
    return lookup.frameNow(media.assetId, media.shotId, VIEWER_FRAME)?.url ?? null;
  };

  const selectedIds = selection?.kind === 'clip' ? multi.selected : [];
  const selectedCount = i18n.number(selectedIds.length);
  const editText = (target: EditItemTarget) => {
    if (edits.pending) return;
    onCloseTask();
    selectTarget(target);
    dispatchView({ type: 'edit-text', target });
  };
  const context = {
    projectId,
    timeline,
    template,
    model,
    playhead,
    zoom: ZOOMS[zoomIndex]!,
    scroller,
    panel,
    onPanel,
    selection,
    select: selectTarget,
    editText,
    textEditRequest,
  };

  const panels = (
    <EditorPanels
      projectId={projectId}
      timeline={timeline}
      model={model}
      playhead={playhead}
      task={task}
      inspect={inspect}
      coverOpened={coverOpened}
      cleanupOpened={cleanupOpened}
      selectedIds={selectedIds}
      selection={selection}
      onSelect={select}
      edits={edits}
      lookup={lookup}
      onAddToChat={addToChat}
      onCloseTask={onCloseTask}
      onVideo={onVideo}
      onCover={() => {
        setCoverOpened(true);
        setInspect('cover');
      }}
    />
  );

  return (
    <EditorContextProvider value={context}>
      {/* EDT1-CMT: C, the bed's Comment… menu, going to a comment, and the composer. */}
      <EditorComments />
      <div
        data-slot="timeline-editor"
        className="@container/editor grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto_auto]"
      >
        <div
          data-slot="editor-stage"
          className="col-start-1 row-start-1 flex min-h-0 min-w-0 items-center justify-center bg-viewer p-3"
        >
          <div className="flex size-full items-center justify-center [container-type:size]">
            <div
              style={{
                width: `min(100cqw, calc(100cqh * ${timeline.canvas.width / timeline.canvas.height}))`,
                height: `min(100cqh, calc(100cqw * ${timeline.canvas.height / timeline.canvas.width}))`,
              }}
            >
              <ViewerHost
                projectId={projectId}
                timeline={timeline}
                totalFrames={model.total}
                frameUrl={frameUrl}
                playhead={playhead}
                handle={handle}
                overlay={<CommentViewerMarker />}
                className="flex size-full min-w-0 flex-col"
              />
            </div>
          </div>
        </div>
        <div
          hidden={!task && !inspect}
          data-slot="editor-inspector-panel"
          className={
            detailed && !task
              ? 'col-start-2 row-start-1 min-h-0 w-[min(18rem,50cqw)] overflow-y-auto border-l border-rule-subtle bg-panel'
              : 'col-span-2 col-start-1 row-start-3 h-60 min-w-0 overflow-y-auto min-[1280px]:h-72'
          }
        >
          <div
            hidden={!detailed || !!task}
            className="sticky top-0 z-10 flex justify-end border-b border-rule-subtle bg-panel px-2 py-1"
          >
            <Button size="sm" variant="ghost" onClick={() => setInspect(null)}>{t`Done`}</Button>
          </div>
          {panels}
        </div>
        <div className="col-span-2 col-start-1 row-start-2 border-t border-rule-subtle">
          <Transport
            detailed={detailed && !task}
            model={model}
            playhead={playhead}
            zoomIndex={zoomIndex}
            onZoom={zoom}
            tools={
              <EditTools
                projectId={projectId}
                detailed={detailed && !task}
                model={model}
                clip={
                  selection?.kind === 'clip'
                    ? model.clips.find((view) => view.item.id === selection.clipId)
                    : undefined
                }
                edits={edits}
              />
            }
          />
          {edits.error ? (
            <div className="px-3 pb-2" data-slot="edit-error">
              <ErrorLine key={`${edits.error.code}:${timeline.revision}`} error={edits.error} />
            </div>
          ) : null}
          {!activity.paused && history.undoTurn ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!!history.busy}
              onClick={() => void history.run('undo')}
            >{t`Undo AI changes`}</Button>
          ) : null}
          <div role="status" className="px-3 type-meta text-ink-2">
            {activity.phase === 'stopping'
              ? t`Stopping…`
              : activity.phase === 'editing'
                ? t`AI is editing · Manual edits are paused`
                : activity.phase === 'interrupted'
                  ? t`Editing was interrupted. Resume or stop the run in chat.`
                  : activity.status !== 'ready'
                    ? t`Reconnecting to editing status…`
                    : null}
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-1 border-t border-rule-subtle px-2 py-1">
            {inspect && !detailed ? (
              <Button size="sm" variant="ghost" onClick={() => setInspect(null)}>{t`Back to scenes`}</Button>
            ) : null}
            {selectedIds.length > 1 ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setInspect('adjust')}
              >{t`Adjust selected (${selectedCount})`}</Button>
            ) : null}
            {(['trim', 'replace', 'words', 'sound', 'more'] as const).map((tool) => (
              <Button
                key={tool}
                data-slot="editor-tool"
                data-tool={tool}
                size="sm"
                variant="ghost"
                aria-pressed={inspect === tool}
                disabled={(tool === 'trim' || tool === 'replace') && selection?.kind !== 'clip'}
                title={
                  (tool === 'trim' || tool === 'replace') && selection?.kind !== 'clip'
                    ? t`Select a scene first`
                    : undefined
                }
                onClick={() => {
                  onCloseTask();
                  setInspect(inspect === tool ? null : tool);
                }}
              >
                {
                  {
                    trim: t`Trim`,
                    replace: t`Replace`,
                    words: t`Words`,
                    sound: t`Sound`,
                    more: authored ? t`Video design` : t`More`,
                  }[tool]
                }
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              data-slot="timeline-detail-toggle"
              aria-pressed={detailed && !task}
              onClick={() => {
                onCloseTask();
                dispatchView({ type: task ? 'show-detail' : 'toggle-detail' });
              }}
            >
              {detailed && !task ? t`Simple scenes` : t`Detailed timeline`}
            </Button>
          </div>
          <div>
            <div hidden={!!task || !!inspect || detailed}>
              <SceneStrip
                aiMarks={aiMarks}
                model={model}
                pictureFor={pictureFor}
                selectedIds={selectedIds}
                onPick={(id, shift, toggle) => {
                  multi.pick(id, shift, toggle);
                  select({ kind: 'clip', clipId: id });
                }}
                onEdit={() => setInspect('trim')}
              />
            </div>
            <div hidden={!!task || !detailed} className="max-h-[min(18rem,35vh)] overflow-y-auto">
              <TimelineBed
                aiMarks={aiMarks}
                model={model}
                zoom={ZOOMS[zoomIndex]!}
                playhead={playhead}
                selectedIds={selectedIds}
                onPick={(id, shift, toggle) => {
                  multi.pick(id, shift, toggle);
                  select({ kind: 'clip', clipId: id });
                }}
                selection={selection}
                onSelect={select}
                pictureFor={pictureFor}
                edits={edits}
                onOpenInspector={() => setInspect('trim')}
                onZoomStep={(step) => zoom(zoomIndex + step)}
                scroller={scroller}
                scale={scale}
              />
            </div>
          </div>
        </div>
      </div>
    </EditorContextProvider>
  );
}
