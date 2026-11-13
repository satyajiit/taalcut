// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type EditItemTarget } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  editorWorkspaceReducer,
  type EditorWorkspaceState,
} from '../src/features/timeline/editor-workspace-state';

const graphic: EditItemTarget = {
  kind: 'item',
  timelineId: newId<'Timeline'>(),
  itemId: newId<'TimelineItem'>(),
  itemKind: 'graphic',
};
const initial: EditorWorkspaceState = { detailed: true, inspector: null, textEditRequest: null };

describe('editor workspace transitions', () => {
  it.each([true, false])('keeps detailed=%s when text editing opens its inspector', (detailed) => {
    const state = { ...initial, detailed };
    const next = editorWorkspaceReducer(state, { type: 'edit-text', target: graphic });
    expect(next.detailed).toBe(detailed);
    expect(next.inspector).toBe('more');
    expect(next.textEditRequest?.itemId).toBe(graphic.itemId);

    const caption = editorWorkspaceReducer(state, {
      type: 'edit-text',
      target: { ...graphic, itemKind: 'caption' },
    });
    expect(caption.detailed).toBe(detailed);
    expect(caption.inspector).toBe('words');
  });

  it('issues a fresh focus request when the same target is opened again', () => {
    const first = editorWorkspaceReducer(initial, { type: 'edit-text', target: graphic });
    const second = editorWorkspaceReducer(first, { type: 'edit-text', target: graphic });
    expect(second.textEditRequest?.itemId).toBe(first.textEditRequest?.itemId);
    expect(second.textEditRequest!.sequence).toBeGreaterThan(first.textEditRequest!.sequence);
    expect(first.textEditRequest!.sequence).toBe(1);
  });

  it('clears pending text focus when closing or replacing its inspector', () => {
    const editing = editorWorkspaceReducer(initial, { type: 'edit-text', target: graphic });
    const closed = editorWorkspaceReducer(editing, { type: 'inspect', tool: null });
    expect(closed).toEqual(initial);
    const replaced = editorWorkspaceReducer(editing, { type: 'inspect', tool: 'adjust' });
    expect(replaced).toMatchObject({ detailed: true, inspector: 'adjust', textEditRequest: null });
    const reopened = editorWorkspaceReducer(closed, { type: 'edit-text', target: graphic });
    expect(reopened.textEditRequest?.itemId).toBe(graphic.itemId);
  });

  it('changes timeline detail mode without carrying a stale editor panel or focus request', () => {
    const editing = editorWorkspaceReducer(initial, { type: 'edit-text', target: graphic });
    const simple = editorWorkspaceReducer(editing, { type: 'toggle-detail' });
    expect(simple).toEqual({ detailed: false, inspector: null, textEditRequest: null });
    expect(editorWorkspaceReducer(simple, { type: 'toggle-detail' })).toEqual(initial);
  });

  it('returns from a task to the detailed timeline even when that mode was already selected', () => {
    const editing = editorWorkspaceReducer(initial, { type: 'edit-text', target: graphic });
    expect(editorWorkspaceReducer(editing, { type: 'show-detail' })).toEqual(initial);
    expect(editorWorkspaceReducer({ ...initial, detailed: false }, { type: 'show-detail' })).toEqual(initial);
  });
});
