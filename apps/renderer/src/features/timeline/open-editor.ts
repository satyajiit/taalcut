// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor on screen, for what sits outside it (EDT1): the docked chat sends its context with every message
 * (the timeline and revision on screen, the playhead, the selection, the part of the bed in view), and a changes
 * card's row selects its item there and puts the playhead on it. Outside React's tree, as the selection chips
 * are: the dock is the editor's sibling, and a card in the full chat opens the editor first, so a focus asked
 * for before the editor is up waits for it.
 */
import {
  MAX_EDITOR_SELECTION,
  TimeRange,
  type EditorContext,
  type EditTarget,
  type FrameRate,
  type ProjectId,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { atRate } from './model';

export interface OpenEditor {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  /** The editor as the user sees it now. */
  context(): EditorContext;
  /**
   * Selects the target, puts the playhead at `at` seconds (or on the item) and brings it into view; null lets go
   * of what is selected.
   */
  focus(target: EditTarget | null, at: number | null): void;
}

interface Focus {
  readonly target: EditTarget;
  readonly at: number | null;
}

let open: OpenEditor | null = null;
let waiting: Focus | null = null;

/** The editor registers itself while it is up; the returned function lets go. */
export function setOpenEditor(editor: OpenEditor): () => void {
  open = editor;
  if (waiting && waiting.target.timelineId === editor.timelineId) {
    const { target, at } = waiting;
    waiting = null;
    editor.focus(target, at);
  }
  return () => {
    if (open === editor) open = null;
  };
}

export function openEditor(): OpenEditor | null {
  return open;
}

/**
 * Focuses the target in the editor when it shows its timeline (true); otherwise keeps it for the editor that
 * opens on that timeline next (false: the caller opens it).
 */
export function focusInEditor(target: EditTarget, at: number | null): boolean {
  if (open && open.timelineId === target.timelineId) {
    open.focus(target, at);
    return true;
  }
  waiting = { target, at };
  return false;
}

/** Forget everything (tests). */
export function resetOpenEditorForTests(): void {
  open = null;
  waiting = null;
}

/** The part of the bed in view, in frames; null when it isn't measured yet. */
export interface VisibleFrames {
  readonly start: number;
  readonly end: number;
}

/** The context a docked message carries, from what the editor shows. Pure, for the tests. */
export function editorContextOf(
  timeline: Pick<Timeline, 'id' | 'revision'>,
  rate: FrameRate,
  playheadFrame: number,
  selection: readonly EditTarget[],
  visible: VisibleFrames | null,
): EditorContext {
  const playhead = atRate(Math.max(0, playheadFrame), rate);
  return {
    timelineId: timeline.id,
    revision: Math.max(1, timeline.revision),
    playhead,
    selection: selection.slice(0, MAX_EDITOR_SELECTION),
    ...(visible && visible.end > visible.start
      ? {
          visibleRange: TimeRange.of(
            atRate(Math.max(0, visible.start), rate),
            atRate(visible.end - Math.max(0, visible.start), rate),
          ),
        }
      : {}),
  };
}

/** Seconds as frames at `rate` (a card row's `at`). */
export function framesAt(seconds: number, rate: FrameRate): number {
  return Math.max(0, Math.round((seconds * rate.num) / rate.den));
}
