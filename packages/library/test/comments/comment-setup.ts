// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A library with a project, a timeline and the comment store and commands on a bus (EDT1-CMT tests). */
import {
  COMMENT_COMMANDS,
  createCommandBus,
  createEventBus,
  newId,
  unwrap,
  type CommandOrigin,
  type EditTarget,
  type TaalcutEvent,
  type TextItem,
  type Timeline,
  type TimelineComment,
  type TimelineCommentId,
} from '@taalcut/core';
import {
  createCommentCommands,
  createCommentStore,
  createLibraryPorts,
  createTimelineStore,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { at, seed, timeline as timelineDocument } from '../stores/documents';

export const person: CommandOrigin = { source: 'ui', actor: 'user' };
export const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };
export const N = COMMENT_COMMANDS;
export const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? 'ok' : result.error?.code;

/** A line of text on T1, frames [start, start + duration). */
export function textItem(start: number, duration: number, text = 'Golden hour'): TextItem {
  return {
    type: 'text',
    id: newId<'TimelineItem'>(),
    start: at(start),
    duration: at(duration),
    text,
    role: 'title',
    slotId: null,
    overlayId: null,
    box: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
    appearance: { size: 0.04, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'title',
    reveal: 'none',
    language: 'en',
    origin: 'user',
  };
}

/** The test timeline: V1 two 60-frame clips and a 30-frame gap; T1 one line of text over frames 10–40. */
export function document(
  projectId: Timeline['projectId'],
  assets: Parameters<typeof timelineDocument>[1],
): Timeline {
  const base = timelineDocument(projectId, assets);
  return {
    ...base,
    tracks: [
      ...base.tracks,
      { kind: 'text', id: 'T1', name: 'Text', enabled: true, items: [textItem(10, 30)] },
    ],
  };
}

export const clips = (timeline: Timeline) => {
  const video = timeline.tracks[0]!;
  return video.items.filter((item) => item.type === 'clip');
};

export const itemTarget = (
  timeline: Timeline,
  itemId: string,
  itemKind: 'clip' | 'text' = 'clip',
): EditTarget => ({ kind: 'item', timelineId: timeline.id, itemId, itemKind }) as EditTarget;

export async function setup() {
  const db = openTestDb({ file: false });
  const ports = createLibraryPorts(db);
  let now = Date.UTC(2026, 10, 1);
  const clock = { now: () => (now += 1) };
  const bus = createCommandBus({ store: ports.auditLog, clock });
  const events = createEventBus({ clock });
  const timelines = createTimelineStore(db, { commands: ports.commands });
  const store = createCommentStore(db, { commands: ports.commands });
  const commands = createCommentCommands({ store, timelines, clock });
  bus.register(...commands.all);
  commands.announce(bus, events);
  const seen: TaalcutEvent[] = [];
  events.onAny((event) => seen.push(event), ['library.changed']);
  const { project, assets } = seed(db);
  const timeline = document(project.id, assets);
  unwrap(await timelines.create(timeline));
  const where = { projectId: project.id, timelineId: timeline.id };

  /** Adds a comment on `anchor` (default: the first clip) as `origin`. */
  const add = async (
    options: { anchor?: EditTarget; at?: number; body?: string; origin?: CommandOrigin } = {},
  ) => {
    const commentId = newId<'TimelineComment'>();
    const anchor = options.anchor ?? itemTarget(timeline, clips(timeline)[0]!.id);
    const result = await bus.dispatch(
      N.add,
      {
        ...where,
        commentId,
        anchor,
        ...(options.at !== undefined ? { at: at(options.at) } : {}),
        body: options.body ?? 'Make this half speed',
      },
      options.origin ?? person,
    );
    return { commentId, result };
  };
  const get = async (commentId: TimelineCommentId): Promise<TimelineComment> =>
    unwrap(await store.get(commentId));
  return { db, ports, bus, events, seen, timelines, store, timeline, where, add, get, project };
}
