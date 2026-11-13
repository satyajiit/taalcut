// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's selection (EDT1): a click on the bed or the inspector, a chip opened from the chat (`?clip=`), and
 * `select(target)` for everything else (a changes card's row, a comment, the gfx and ops lanes' panels), which
 * also puts the playhead on the target and brings it into view. What is selected is the chip ⌘⇧A adds, and the
 * docked chat reads it, with the playhead and the bed in view, from the open editor (open-editor.ts).
 */
import {
  findEditItem,
  type EditTarget,
  type ProjectId,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { setCurrentSelection } from '../../chat/selection-store';
import type { TimelineModel } from './model';
import { editorContextOf, framesAt, setOpenEditor, type VisibleFrames } from './open-editor';
import type { Playhead } from './playhead';
import { fromTarget, selectedItemId, toChip, toTarget, type EditorSelection } from './selection';

export interface EditorSelectionState {
  readonly selection: EditorSelection;
  /** A click: selecting a clip puts the playhead on its first frame (UX4). */
  select(next: EditorSelection): void;
  /** Selects a target, puts the playhead at `at` seconds (else on the target) and brings it into view. */
  selectTarget(target: EditTarget | null, at?: number | null): void;
}

export interface EditorSelectionOptions {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  readonly model: TimelineModel;
  readonly playhead: Playhead;
  /** The clip in the address (`?clip=`), and how to change it. */
  readonly clip: TimelineItemId | undefined;
  readonly onClip: (clip: TimelineItemId | undefined) => void;
  readonly scroller: RefObject<HTMLDivElement | null>;
  /** Pixels per frame at the bed's zoom, as the bed last drew it. */
  readonly scale: RefObject<number>;
  /** A card opened this target; show its local controls as well as selecting it. */
  readonly onFocus?: (target: EditTarget) => void;
}

/** Scrolls the item with this id into view on the bed. */
function reveal(id: string) {
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-clip-id="${id}"], [data-text-id="${id}"], [data-item-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' }),
  );
}

function visibleOf(box: HTMLDivElement | null, pxPerFrame: number): VisibleFrames | null {
  if (!box || !(pxPerFrame > 0) || box.clientWidth === 0) return null;
  return { start: box.scrollLeft / pxPerFrame, end: (box.scrollLeft + box.clientWidth) / pxPerFrame };
}

/** True while the selected thing is still on the timeline. */
function stillThere(selection: EditorSelection, timeline: Timeline, model: TimelineModel): boolean {
  if (!selection || selection.kind === 'range') return true;
  if (selection.kind === 'clip') return model.clips.some((view) => view.item.id === selection.clipId);
  if (selection.kind === 'text') return model.texts.some((view) => view.item.id === selection.itemId);
  return findEditItem(timeline, selection.itemId) !== null;
}

export function useEditorSelection(options: EditorSelectionOptions): EditorSelectionState {
  const { projectId, timeline, model, playhead, clip, onClip, scroller, scale } = options;
  const [selection, setSelection] = useState<EditorSelection>(clip ? { kind: 'clip', clipId: clip } : null);

  const select = (next: EditorSelection) => {
    setSelection(next);
    onClip(next?.kind === 'clip' ? next.clipId : undefined);
    if (next?.kind === 'clip') {
      const view = model.clips.find((candidate) => candidate.item.id === next.clipId);
      if (view) playhead.seek(view.start);
    }
  };

  const selectTarget = (target: EditTarget | null, at: number | null = null) => {
    const next = fromTarget(target, model.rate);
    setSelection(next);
    onClip(next?.kind === 'clip' ? next.clipId : undefined);
    const id = selectedItemId(next);
    const place = id ? findEditItem(timeline, id) : null;
    const frame =
      at !== null
        ? framesAt(at, model.rate)
        : next?.kind === 'range'
          ? next.start
          : place
            ? Math.max(0, place.start)
            : null;
    if (frame !== null) playhead.seek(Math.min(frame, Math.max(0, model.total - 1)));
    if (id) reveal(id);
  };

  // A chip opened from the chat (?clip=): select it, put the playhead on it, bring it into view.
  useEffect(() => {
    if (!clip || (selection?.kind === 'clip' && selection.clipId === clip)) return;
    const view = model.clips.find((candidate) => candidate.item.id === clip);
    if (!view) return;
    setSelection({ kind: 'clip', clipId: clip });
    playhead.seek(view.start);
    reveal(clip);
  }, [clip, model]);

  // Something selected that an edit took away (⌘Z of a split, the agent's change): let go of it.
  useEffect(() => {
    if (!stillThere(selection, timeline, model)) select(null);
  }, [model]);

  // ⌘⇧A and ⌘K's "Add to chat" read what is selected here.
  useEffect(
    () => setCurrentSelection(toChip(selection, timeline.id, model.rate)),
    [selection, timeline.id, model.rate],
  );
  useEffect(() => () => setCurrentSelection(null), []);

  // The docked chat and the cards reach the editor through the open editor; it reads the latest of everything.
  const latest = useRef({ selection, timeline, model, selectTarget, onFocus: options.onFocus });
  latest.current = { selection, timeline, model, selectTarget, onFocus: options.onFocus };
  useEffect(
    () =>
      setOpenEditor({
        projectId,
        timelineId: timeline.id,
        context() {
          const now = latest.current;
          const target = toTarget(now.selection, now.timeline.id, now.model.rate);
          return editorContextOf(
            now.timeline,
            now.model.rate,
            playhead.frame(),
            target ? [target] : [],
            visibleOf(scroller.current, scale.current),
          );
        },
        focus: (target, at) => {
          latest.current.selectTarget(target, at);
          if (target) latest.current.onFocus?.(target);
        },
      }),
    [projectId, timeline.id, playhead, scroller, scale],
  );

  return { selection, select, selectTarget };
}
