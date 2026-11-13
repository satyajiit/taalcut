// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { EditItemTarget } from '@taalcut/core';
import type { SelectionTool } from './selection-tool';

export type InspectorTool = SelectionTool | 'adjust' | 'cover';

export interface EditorWorkspaceState {
  readonly detailed: boolean;
  readonly inspector: InspectorTool | null;
  readonly textEditRequest: { readonly itemId: string; readonly sequence: number } | null;
}

type WorkspaceAction =
  | { type: 'inspect'; tool: InspectorTool | null }
  | { type: 'toggle-detail' }
  | { type: 'show-detail' }
  | { type: 'edit-text'; target: EditItemTarget };

/** View transitions preserve the timeline mode and retire focus requests when their panel closes. */
export function editorWorkspaceReducer(
  state: EditorWorkspaceState,
  action: WorkspaceAction,
): EditorWorkspaceState {
  switch (action.type) {
    case 'inspect':
      return { ...state, inspector: action.tool, textEditRequest: null };
    case 'toggle-detail':
      return { detailed: !state.detailed, inspector: null, textEditRequest: null };
    case 'show-detail':
      return { detailed: true, inspector: null, textEditRequest: null };
    case 'edit-text':
      return {
        ...state,
        inspector: action.target.itemKind === 'caption' ? 'words' : 'more',
        textEditRequest: {
          itemId: action.target.itemId,
          sequence: (state.textEditRequest?.sequence ?? 0) + 1,
        },
      };
  }
}
