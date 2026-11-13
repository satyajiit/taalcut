// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { editItemsOf, type EditorActivity, type Timeline } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';

const fingerprints = (timeline: Timeline) => {
  const items = new Map(
    timeline.tracks.flatMap((track) => track.items.map((item) => [item.id as string, item])),
  );
  return new Map(
    editItemsOf(timeline).map((place) => [
      place.target.itemId as string,
      JSON.stringify({
        place,
        item: items.get(place.target.itemId),
        grade: timeline.grade,
        style: timeline.styleId,
        canvas: timeline.canvas,
        mix: timeline.mix,
        music: timeline.music,
      }),
    ]),
  );
};

export type AiEditMark = 'target' | 'changed';

/** Presentation only: the ownership stream supplies the request's original selection in every window. */
export function useAiEditMarks(timeline: Timeline, activity: EditorActivity | undefined) {
  const previous = useRef(timeline);
  const run = useRef(activity?.runId);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const currentRun = activity?.runId;
    const editing = activity?.phase === 'editing' || activity?.phase === 'stopping';
    const reset = previous.current.id !== timeline.id || (!!currentRun && currentRun !== run.current);
    const before = fingerprints(previous.current);
    const after = fingerprints(timeline);
    const updates = editing
      ? [...after].filter(([id, value]) => before.get(id) !== value).map(([id]) => id)
      : [];
    setChanged((old) => (reset ? new Set(updates) : updates.length ? new Set([...old, ...updates]) : old));
    previous.current = timeline;
    run.current = currentRun;
  }, [timeline, activity?.runId, activity?.phase]);
  const marks = new Map<string, AiEditMark>(
    [
      ...changed,
      ...(activity?.changes
        ?.filter((change) => change.timelineId === timeline.id)
        .flatMap((change) => change.affectedItemIds) ??
        activity?.changedItemIds ??
        []),
    ].map((id) => [id, 'changed']),
  );
  const context = activity?.context;
  if (context?.timelineId === timeline.id && activity?.phase !== 'idle') {
    for (const id of activity?.targetItemIds ??
      context.selection.flatMap((target) => (target.kind === 'item' ? [target.itemId] : []))) {
      if (!marks.has(id)) marks.set(id, 'target');
    }
  }
  return marks;
}
