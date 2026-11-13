// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX in the renderer: the editor's selection as edit targets and chips, the context a docked message
 * carries, a focus that waits for the editor, where the dock opens, the changes card's turn status and the fake
 * agent's changes card. Against the Make fakes' Golden hour market (src/backend/fake/make).
 */
import {
  editItemsOf,
  newId,
  type EditTarget,
  type ProjectId,
  type SelectionChip,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { seedProjects } from '../src/backend/fake/make/seed';
import { turnStatus } from '../src/chat/edit-turn';
import { changesCard } from '../src/chat/fake-edit-script';
import { DOCK_STORAGE_KEY, rememberDock, rememberedDock } from '../src/features/timeline/dock/dock-memory';
import { dockedContext } from '../src/features/timeline/dock/docked-context';
import { buildModel } from '../src/features/timeline/model';
import {
  editorContextOf,
  focusInEditor,
  openEditor,
  resetOpenEditorForTests,
  setOpenEditor,
  type OpenEditor,
} from '../src/features/timeline/open-editor';
import { createPlayhead } from '../src/features/timeline/playhead';
import { useEditorSelection } from '../src/features/timeline/use-editor-selection';
import { chipTarget, fromTarget, toTarget } from '../src/features/timeline/selection';

const golden = seedProjects()
  .projects.flatMap((project) => project.timelines)
  .find((timeline) => timeline.id === GOLDEN_TIMELINES[0])!;
const model = buildModel(golden);
const rate = model.rate;
const timelineId = golden.id as TimelineId;
const clip = (n: number) => model.clips[n - 1]!.item.id;
const clipTarget = (n: number): EditTarget => ({
  kind: 'item',
  timelineId,
  itemId: clip(n),
  itemKind: 'clip',
});

afterEach(() => {
  resetOpenEditorForTests();
  window.localStorage.clear();
});

describe('the editor’s selection as a target (EDT1-CTX)', () => {
  it('goes to a target and back for a clip, words on screen, other items and a stretch of time', () => {
    const text = model.texts[0]!.item.id;
    const graphic = newId<'TimelineItem'>();
    for (const selection of [
      { kind: 'clip', clipId: clip(3) },
      { kind: 'text', itemId: text },
      { kind: 'item', itemId: graphic, itemKind: 'graphic' },
      { kind: 'range', start: 30, end: 90 },
    ] as const)
      expect(fromTarget(toTarget(selection, timelineId, rate), rate)).toEqual(selection);
    expect(toTarget({ kind: 'text', itemId: text }, timelineId, rate)).toEqual({
      kind: 'item',
      timelineId,
      itemId: text,
      itemKind: 'text',
    });
    expect(fromTarget({ kind: 'timeline', timelineId }, rate)).toBeNull();
    expect(toTarget(null, timelineId, rate)).toBeNull();
  });

  it('reads the chips that point at a timeline as targets, and nothing for slots and effects', () => {
    const chip: SelectionChip = { kind: 'clip', timelineId, clipId: clip(2) };
    expect(chipTarget(chip)).toEqual(clipTarget(2));
    const slot = { kind: 'slot', templateId: newId<'Template'>(), slotId: newId<'TemplateSlot'>() } as const;
    expect(chipTarget(slot)).toBeNull();
  });
});

describe('what a docked message carries (EDT1-CTX)', () => {
  const editor = (selection: EditTarget[]): OpenEditor => ({
    projectId: golden.projectId,
    timelineId,
    context: () => editorContextOf(golden, rate, 75, selection, { start: 0, end: 300 }),
    focus: vi.fn(),
  });

  it('the timeline and revision on screen, the playhead, the bed in view and the selection', () => {
    const context = editorContextOf(golden, rate, 75, [clipTarget(3)], { start: 30, end: 330 });
    expect(context).toMatchObject({
      timelineId,
      revision: golden.revision,
      playhead: { value: 75 },
      selection: [clipTarget(3)],
      visibleRange: { start: { value: 30 }, duration: { value: 300 } },
    });
    expect(editorContextOf(golden, rate, -5, [], null)).not.toHaveProperty('visibleRange');
    expect(editorContextOf(golden, rate, -5, [], null).playhead.value).toBe(0);
  });

  it('points at the selection first, then the chips on this timeline, each once', () => {
    const other = newId<'Timeline'>();
    const context = dockedContext(editor([clipTarget(3)]), [
      { kind: 'clip', timelineId, clipId: clip(3) },
      { kind: 'clip', timelineId, clipId: clip(5) },
      { kind: 'clip', timelineId: other, clipId: newId<'TimelineItem'>() },
    ]);
    expect(context?.selection).toEqual([clipTarget(3), clipTarget(5)]);
    expect(dockedContext(null, [])).toBeUndefined();
  });

  it('keeps a row’s focus for the editor that opens on its video', () => {
    expect(focusInEditor(clipTarget(4), 2.5)).toBe(false);
    const up = editor([]);
    const done = setOpenEditor(up);
    expect(up.focus).toHaveBeenCalledWith(clipTarget(4), 2.5);
    expect(focusInEditor(clipTarget(2), null)).toBe(true);
    expect(up.focus).toHaveBeenLastCalledWith(clipTarget(2), null);
    done();
    expect(focusInEditor(clipTarget(2), null)).toBe(false);
  });

  it('clears an open editor selection without opening controls for a null target', () => {
    const onFocus = vi.fn();
    const onClip = vi.fn();
    const { result } = renderHook(() =>
      useEditorSelection({
        projectId: golden.projectId,
        timeline: golden,
        model,
        playhead: createPlayhead(),
        clip: undefined,
        onClip,
        scroller: { current: null },
        scale: { current: 1 },
        onFocus,
      }),
    );
    act(() => openEditor()?.focus(clipTarget(2), null));
    expect(result.current.selection).toEqual({ kind: 'clip', clipId: clip(2) });
    expect(onFocus).toHaveBeenCalledOnce();
    act(() => openEditor()?.focus(null, null));
    expect(result.current.selection).toBeNull();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onClip).toHaveBeenLastCalledWith(undefined);
  });
});

describe('where the dock opens (EDT1-CTX)', () => {
  const project = newId<'Project'>() as ProjectId;

  it('on Chat, then as you left it in that project', () => {
    expect(rememberedDock(project, true)).toBe('chat');
    rememberDock(project, 'versions');
    expect(rememberedDock(project, true)).toBe('versions');
    rememberDock(project, null);
    expect(rememberedDock(project, true)).toBeNull();
    expect(rememberedDock(newId<'Project'>(), true)).toBe('chat');
    // Clean up opens from its card or ⌘K only.
    rememberDock(project, 'cleanup');
    expect(rememberedDock(project, true)).toBe('chat');
    // A project with no cut yet, or a window too narrow for the dock: closed, until you open it.
    expect(rememberedDock(newId<'Project'>(), false)).toBeNull();
    expect(rememberedDock(project, false)).toBe('chat');
  });

  it('on Chat when what it kept can’t be read', () => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, '{not json');
    expect(rememberedDock(project, true)).toBe('chat');
    window.localStorage.setItem(DOCK_STORAGE_KEY, '[1]');
    expect(rememberedDock(project, true)).toBe('chat');
  });
});

describe('the changes card in the app (EDT1-CTX)', () => {
  it('follows the history: next undo, next redo, under later changes, or gone after an undo', () => {
    const group = 'turn:run';
    expect(turnStatus(undefined, group, undefined)).toBe('unknown');
    expect(turnStatus({ undoGroup: group }, group, undefined)).toBe('applied');
    expect(turnStatus({ redoGroup: group }, group, 'applied')).toBe('undone');
    expect(turnStatus({ undoGroup: null }, group, 'applied')).toBe('later');
    // Undone here, then something else changed: its redo went, and nothing brings it back.
    expect(turnStatus({ undoGroup: null, redoGroup: null }, group, 'undone')).toBe('unknown');
    expect(turnStatus(undefined, group, 'applied')).toBe('applied');
  });

  it('the fake agent’s trim ends a docked run with the clip’s new length, in the run’s turn', () => {
    const runId = newId<'AgentRun'>();
    const third = clip(3);
    const shorter = {
      ...golden,
      revision: golden.revision + 1,
      tracks: golden.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : {
              ...track,
              items: track.items.map((item) =>
                item.id === third && item.type === 'clip'
                  ? { ...item, duration: { ...item.duration, value: item.duration.value - 15 } }
                  : item,
              ),
            },
      ),
    };
    const card = changesCard(runId, golden, shorter);
    expect(card).toMatchObject({
      type: 'editChanges',
      group: `turn:${runId}`,
      revisionBefore: golden.revision,
      revisionAfter: golden.revision + 1,
      changes: [{ number: 3, change: { kind: 'length' } }],
    });
    expect(changesCard(runId, golden, golden)).toBeNull();
    // Every item the card can name is one the editor numbers alike.
    expect(editItemsOf(golden).filter((place) => place.target.itemKind === 'clip')).toHaveLength(12);
    expect((card?.type === 'editChanges' && card.changes[0]?.target) || null).toMatchObject({
      itemId: third as TimelineItemId,
    });
  });
});
