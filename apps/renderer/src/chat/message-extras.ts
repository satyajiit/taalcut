// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What a chat message carries besides its words, as the renderer hands it to `chat.send`. */
import type {
  ChatStart,
  CoverRequest,
  EditorContext,
  PostCaptionRequest,
  SelectionChip,
  TimelineCommentId,
} from '@taalcut/core';
import { selectionKey } from './selection-store';

/** What a message carries besides its words (core's messageExtrasShape). */
export interface MessageExtras {
  readonly start?: ChatStart;
  readonly selections?: readonly SelectionChip[];
  /** EDT1-CMT: the comments it sends to Taalcut. */
  readonly comments?: readonly TimelineCommentId[];
  /** EDT1: the editor as the user saw it, from the docked chat. */
  readonly editorContext?: EditorContext;
  /** CVR1: the cover asked for in the editor's cover panel ("Generate with AI"), at the aspect picked there. */
  readonly cover?: CoverRequest;
  /** CAP1: the post caption asked for in the editor's caption panel, for the platform picked there. */
  readonly postCaption?: PostCaptionRequest;
}

/** The chips once each, first first (the docked chat's selection may also have been added). */
export function once(chips: readonly SelectionChip[]): SelectionChip[] {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    const key = selectionKey(chip);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
