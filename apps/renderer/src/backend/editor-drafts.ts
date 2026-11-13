// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  ConflictError,
  err,
  ok,
  ValidationError,
  type AsyncResult,
  type Timeline,
  type TimelineId,
  type ProjectId,
  type TextItem,
} from '@taalcut/core';
import type { Backend } from './contract';

type Snapshot = { value: string; base: string; revision: number; conflict: boolean; saving: boolean };
export type DraftTarget = { timeline: Timeline; itemId: string; kind: 'text' | 'caption' };
const textOf = (timeline: Timeline, target: DraftTarget): string | undefined =>
  target.kind === 'caption'
    ? timeline.captions?.cues
        .find((cue) => cue.id === target.itemId)
        ?.words.map((word) => word.text)
        .join(' ')
    : timeline.tracks
        .flatMap((track) => (track.kind === 'text' ? track.items : []))
        .find((item): item is TextItem => item.id === target.itemId && item.type === 'text')?.text;

/** A window owns its drafts even while a field is unmounted or another window owns editing. */
export function createEditorDrafts(backend: Pick<Backend, 'timelines' | 'commands'>) {
  const entries = new Map<string, Draft>();
  function create(target: DraftTarget) {
    const initial = textOf(target.timeline, target) ?? '';
    let state: Snapshot = {
      value: initial,
      base: initial,
      revision: target.timeline.revision,
      conflict: false,
      saving: false,
    };
    let latest = initial;
    const listeners = new Set<() => void>();
    let flight: AsyncResult<void> | undefined;
    const publish = (next: Snapshot) => {
      state = next;
      for (const fn of listeners) fn();
    };
    const observe = (timeline: Timeline) => {
      const text = textOf(timeline, target);
      latest = text ?? '';
      const dirty = state.value !== state.base;
      const conflict = dirty && (text === undefined || (text !== state.base && text !== state.value));
      const value = dirty ? state.value : latest;
      const next = {
        ...state,
        value,
        base: dirty && conflict ? state.base : latest,
        revision: timeline.revision,
        conflict,
      };
      if (JSON.stringify(next) !== JSON.stringify(state)) publish(next);
    };
    const perform = async (overwrite = false): AsyncResult<void> => {
      if (state.value === state.base && !state.conflict) return ok(undefined);
      const submitted = state.value;
      const value = submitted.trim().replace(/\s+/g, ' ');
      if ((target.kind === 'text' && !value) || value.length > 500)
        return err(ValidationError({ field: 'text' }));
      const current = await callRpc(backend.timelines.get({ timelineId: target.timeline.id }));
      if (!current.ok) return current;
      observe(current.value);
      if (textOf(current.value, target) === undefined || (state.conflict && !overwrite))
        return err(ConflictError({ entity: target.kind, id: target.itemId }));
      const command = target.kind === 'caption' ? 'captions.editText' : 'timeline.editText';
      publish({ ...state, saving: true });
      const result = await callRpc(
        backend.commands.dispatch({
          name: command,
          source: 'ui',
          payload: {
            projectId: target.timeline.projectId,
            timelineId: target.timeline.id,
            revision: current.value.revision,
            ...(target.kind === 'caption' ? { cueId: target.itemId } : { itemId: target.itemId }),
            text: value,
          },
        }),
      );
      if (result.ok) latest = value;
      publish({
        ...state,
        saving: false,
        ...(result.ok
          ? { base: value, value: state.value === submitted ? value : state.value, conflict: false }
          : {}),
      });
      return result.ok ? ok(undefined) : result;
    };
    const draft = {
      timelineId: target.timeline.id,
      projectId: target.timeline.projectId,
      snapshot: () => state,
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      observe,
      set(value: string) {
        publish({ ...state, value });
      },
      discard() {
        publish({ ...state, value: latest, base: latest, conflict: false });
      },
      save(overwrite = false): AsyncResult<void> {
        if (flight) return flight;
        flight = perform(overwrite).finally(() => {
          flight = undefined;
        });
        return flight;
      },
    };
    return draft;
  }
  type Draft = ReturnType<typeof create>;
  return {
    get(target: DraftTarget): Draft {
      const key = `${target.timeline.id}:${target.kind}:${target.itemId}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = create(target);
        entries.set(key, entry);
      }
      return entry;
    },
    async flush(timelineId: TimelineId, projectId?: ProjectId): AsyncResult<void> {
      const dirty = () =>
        [...entries.values()].filter(
          (entry) =>
            (projectId ? entry.projectId === projectId : entry.timelineId === timelineId) &&
            (entry.snapshot().value !== entry.snapshot().base || entry.snapshot().conflict),
        );
      while (dirty().length) {
        for (const entry of dirty()) {
          const saved = await entry.save();
          if (!saved.ok) return saved;
        }
      }
      return ok(undefined);
    },
  };
}
export type EditorDrafts = ReturnType<typeof createEditorDrafts>;
