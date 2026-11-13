// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a docked message carries (EDT1): the editor as the user sees it, with its selection being what the
 * message points at: the editor's selection first, then the chips added to the message that are on the open
 * timeline, each once. Without an open editor (the dock outside one), nothing.
 */
import {
  MAX_EDITOR_SELECTION,
  sameEditTarget,
  type EditorContext,
  type EditTarget,
  type SelectionChip,
} from '@taalcut/core';
import type { OpenEditor } from '../open-editor';
import { chipTarget } from '../selection';

export function dockedContext(
  editor: OpenEditor | null,
  chips: readonly SelectionChip[],
): EditorContext | undefined {
  if (!editor) return undefined;
  const context = editor.context();
  const targets: EditTarget[] = [];
  const add = (target: EditTarget | null) => {
    if (!target || target.timelineId !== context.timelineId) return;
    if (!targets.some((other) => sameEditTarget(other, target))) targets.push(target);
  };
  for (const target of context.selection) add(target);
  for (const chip of chips) add(chipTarget(chip));
  return { ...context, selection: targets.slice(0, MAX_EDITOR_SELECTION) };
}
