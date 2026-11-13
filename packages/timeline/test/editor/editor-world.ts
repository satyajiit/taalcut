// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: a timeline on core's real bus (command-world.ts) with a shot to insert, for the editor's edits. */
import { RationalTime, type CommandOrigin, type ShotProfile, type Timeline } from '@taalcut/core';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { agentOrigin, commandWorld, ui } from '../fixtures/command-world';
import { makeProfile, unitVector } from '../fixtures/library';
import { buildTimeline, type TimelineDef } from '../fixtures/timeline';

export const f = (value: number) => RationalTime.of(value, { num: 30, den: 1 });
export { agentOrigin, ui };

export async function editorWorld(
  def: TimelineDef,
  shots: readonly ShotProfile[] = [makeProfile({ embedding: unitVector(1), frames: 300 })],
  prepare: (timeline: Timeline) => Timeline = (timeline) => timeline,
) {
  const world = commandWorld({ catalog: createMemoryShotCatalog(shots) });
  const built = buildTimeline(def);
  const first = prepare(built.timeline);
  const created = await world.dispatch('timeline.create', { projectId: first.projectId, timelines: [first] });
  if (!created.ok) throw new Error(created.error.code);
  const target = { projectId: built.timeline.projectId, timelineId: built.timeline.id };
  const doc = (): Timeline => world.doc(built.timeline.id);
  const run = (name: string, payload: Record<string, unknown>, origin: CommandOrigin = ui) =>
    world.dispatch(name, { ...target, ...payload }, origin);
  const undo = () => world.bus.undo(target.projectId, ui);
  const redo = () => world.bus.redo(target.projectId, ui);
  return { ...world, built, target, doc, run, undo, redo, shots };
}

/** V1's clips and gaps as [kind, frames] pairs, transitions as their kind. */
export function shape(timeline: Timeline): (readonly [string, number] | string)[] {
  const video = timeline.tracks[0];
  if (video?.kind !== 'video') return [];
  return video.items.map((item) => (item.type === 'transition' ? item.kind : [item.type, item.duration.value] as const));
}
