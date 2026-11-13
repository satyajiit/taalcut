// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { renderHook } from '@testing-library/react';
import { newId, type EditorActivity } from '@taalcut/core';
import { expect, it } from 'vitest';
import { useAiEditMarks } from '../src/features/timeline/ai-edit-marks';
import { seedProjects } from '../src/backend/fake/make/seed';

it('keeps committed AI marks when idle arrives before the final document', () => {
  const timeline = structuredClone(seedProjects().projects[0]!.timelines[0]!);
  const clip = timeline.tracks[0]!.items[0]!;
  const activity: EditorActivity = {
    projectId: timeline.projectId,
    runId: newId<'AgentRun'>(),
    phase: 'editing',
    generation: 1,
  };
  const { result, rerender } = renderHook(({ doc, state }) => useAiEditMarks(doc, state), {
    initialProps: { doc: timeline, state: activity },
  });
  const idle: EditorActivity = {
    ...activity,
    runId: null,
    phase: 'idle',
    generation: 3,
    changedItemIds: [clip.id],
  };
  rerender({ doc: timeline, state: idle });
  expect(result.current.get(clip.id)).toBe('changed');
  rerender({ doc: { ...timeline, revision: timeline.revision + 1 }, state: idle });
  expect(result.current.get(clip.id)).toBe('changed');
});

// Size copies retain item identities, so a receipt must stay scoped to its own document.
it('does not mark the original when an independent copy changes the same clip id', () => {
  const timeline = structuredClone(seedProjects().projects[0]!.timelines[0]!);
  const clip = timeline.tracks[0]!.items[0]!;
  const copiedId = newId<'Timeline'>();
  const state: EditorActivity = {
    projectId: timeline.projectId,
    runId: null,
    phase: 'idle',
    generation: 4,
    changedItemIds: [clip.id],
    changes: [{ timelineId: copiedId, revision: 2, affectedItemIds: [clip.id] }],
  };
  const { result, rerender } = renderHook(({ doc }) => useAiEditMarks(doc, state), {
    initialProps: { doc: timeline },
  });
  expect(result.current.has(clip.id)).toBe(false);
  rerender({ doc: { ...timeline, id: copiedId } });
  expect(result.current.get(clip.id)).toBe('changed');
});
