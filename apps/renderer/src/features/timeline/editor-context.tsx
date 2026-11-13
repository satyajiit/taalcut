// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the editor's Phase 3 parts read without threading props through the bed (P3-V12 pacing, P3-B8 gap
 * blocks, P3-V9 cleanup, P3-V10 the look): the project, the open timeline and its template, the editor's model,
 * the playhead, the bed's zoom and scroller, which panel is open (`?panel=`), and (EDT1) what is selected and
 * `select(target)`, for the gfx and ops lanes' parts and anything else that points at a thing on the bed.
 */
import type { EditItemTarget, EditTarget, ProjectId, Template, Timeline } from '@taalcut/core';
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { TimelineModel } from './model';
import type { Playhead } from './playhead';
import type { EditorSelection } from './selection';

export type EditorPanel = 'cleanup' | 'pacing' | 'gaps';

export interface EditorContextValue {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  readonly template: Template | null;
  readonly model: TimelineModel;
  readonly playhead: Playhead;
  /** Pixels per frame at the bed's zoom. */
  readonly zoom: number;
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly panel: EditorPanel | undefined;
  readonly onPanel: (panel: EditorPanel | undefined) => void;
  /** What is selected: a clip, text, another item (graphic, caption, audio, transition) or a stretch of time. */
  readonly selection: EditorSelection;
  /**
   * Selects an edit target (null: nothing), puts the playhead at `at` seconds or else on the target, and brings
   * it into view. It becomes the chip ⌘⇧A adds and what "this" means in the docked chat.
   */
  readonly select: (target: EditTarget | null, at?: number | null) => void;
  /** Opens the selected item's editable words beside the viewer, without a chat turn. */
  readonly editText: (target: EditItemTarget) => void;
  readonly textEditRequest: { readonly itemId: string; readonly sequence: number } | null;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorContextProvider({
  value,
  children,
}: {
  value: EditorContextValue;
  children: ReactNode;
}) {
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

/** The open editor's context; null outside the editor (a card in the chat, /dev/kit). */
export function useEditorContext(): EditorContextValue | null {
  return useContext(EditorContext);
}

/**
 * EDT1: the editor's `select(target, at)`, for the other lanes' parts of the bed and inspector (a graphic, an audio
 * clip, a caption): what they call on click. Undefined outside the editor. The chip ⌘⇧A adds follows the
 * selection (selection.ts's `toChip`).
 */
export function useEditorSelect(): EditorContextValue['select'] | undefined {
  return useContext(EditorContext)?.select;
}
