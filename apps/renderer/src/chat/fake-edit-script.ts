// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model output: data, never translated */

/**
 * The fake agent's edit (P2-M7, V3, EDT1-CTX): "make this shot shorter" (or longer) trims a clip's end by a
 * beat, as the agent: `timeline.trimClip` on the fake's bus from source 'agent', in the run's turn group (so one
 * ⌘Z or the changes card's Undo all takes it back), and the editor's watch shows the new cut. The clip is the
 * one a clip chip points at, or, from the docked chat, what the editor has selected, else the clip under the
 * playhead. A docked run ends with the changes card (core's diffEdits over the snapshots before and after), as
 * the agent's does; one from the full chat with the timeline card. A message that points at no clip asks for
 * one. The fake chat has no backend client: it reads the fake's timelines and bus through `window.taalcutFake`,
 * which only the fake backend sets.
 */
import {
  agentTurnGroup,
  diffEdits,
  editSnapshot,
  MIN_CLIP_FRAMES,
  RationalTime,
  TIMELINE_COMMANDS,
  type Card,
  type EditorContext,
  type RunId,
  type SelectionChip,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { buildModel, clipAt, type ClipView, type TimelineModel } from '../features/timeline/model';
import { chunks, event, type Beat, type ScriptIds } from './fake-script';

const ASKS = /\b(shorter|shorten|trim|tighten|longer|lengthen|extend)\b/i;
const LONGER = /\b(longer|lengthen|extend)\b/i;

/** True when the message asks to make a clip shorter or longer: the edit script answers it. */
export function asksForTrim(text: string): boolean {
  return ASKS.test(text);
}

function say(ids: ScriptIds, text: string): Beat[] {
  const { runId, messageId } = ids;
  return chunks(text).map((delta) => ({
    wait: 40,
    event: event('agent.messageDelta', { runId, messageId, delta }),
  }));
}

function think(ids: ScriptIds, text: string): Beat[] {
  const { runId } = ids;
  return chunks(text).map((delta) => ({ wait: 30, event: event('agent.reasoningDelta', { runId, delta }) }));
}

/** Why the trim can't be done, judged before running it so the reply can say so; null when it can. */
function refusal(model: TimelineModel, clip: ClipView | undefined, longer: boolean): string | null {
  if (!clip) return 'That clip isn’t in the video any more, so there was nothing to trim.';
  const n = clip.number;
  if (clip.item.locked) return `Clip ${n} is locked, so I left it as it is. Unlock it and ask again.`;
  if (!longer && clip.end - clip.start - model.beatFrames < MIN_CLIP_FRAMES)
    return `Clip ${n} is already as short as a clip can be.`;
  return null;
}

interface Pointed {
  readonly timelineId: TimelineId;
  /** The clip, or null for the one under the playhead. */
  readonly clipId: TimelineItemId | null;
}

/** The clip the message points at: a clip chip, then the editor's selection, then the playhead's clip. */
function pointedAt(selections: readonly SelectionChip[], editor: EditorContext | undefined): Pointed | null {
  for (const chip of selections) {
    if (chip.kind === 'clip') return { timelineId: chip.timelineId, clipId: chip.clipId };
    if (chip.kind === 'item' && chip.itemKind === 'clip')
      return { timelineId: chip.timelineId, clipId: chip.itemId as TimelineItemId };
  }
  if (!editor) return null;
  const selected = editor.selection.find((target) => target.kind === 'item' && target.itemKind === 'clip');
  if (selected?.kind === 'item')
    return { timelineId: selected.timelineId, clipId: selected.itemId as TimelineItemId };
  return { timelineId: editor.timelineId, clipId: null };
}

function timelineCard(runId: RunId, now: Timeline): Card {
  const cut = buildModel(now);
  return {
    type: 'timeline',
    id: `timeline:${runId}`,
    version: 1,
    runId,
    projectId: now.projectId,
    timelineId: now.id,
    revision: now.revision,
    duration: { value: cut.total, rate: now.canvas.rate },
    clipCount: cut.clips.length,
  };
}

/** The changes card a docked run ends with, from the timeline before and after; null if nothing changed. */
export function changesCard(runId: RunId, before: Timeline, now: Timeline): Card | null {
  const { changes, more } = diffEdits(editSnapshot(before), editSnapshot(now));
  if (now.revision === before.revision || changes.length === 0) return null;
  return {
    type: 'editChanges',
    id: `edit-changes:${runId}`,
    version: 1,
    runId,
    projectId: now.projectId,
    timelineId: now.id,
    group: agentTurnGroup(runId),
    revisionBefore: before.revision,
    revisionAfter: now.revision,
    changes,
    more,
  };
}

export function trimScript(
  ids: ScriptIds,
  text: string,
  selections: readonly SelectionChip[],
  editor?: EditorContext,
): Beat[] {
  const { runId, conversationId } = ids;
  const start: Beat = { wait: 0, event: event('agent.runStarted', { runId, conversationId }) };
  const end: Beat = { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) };
  const fake = window.taalcutFake;
  const pointed = pointedAt(selections, editor);
  const timeline = pointed ? fake?.make.timelines.get(pointed.timelineId) : undefined;
  if (!fake || !pointed || !timeline)
    return [
      start,
      ...say(
        ids,
        'Which clip? Select it on the timeline and press ⌘⇧A to add it to this message, then ask again.',
      ),
      end,
    ];

  const longer = LONGER.test(text);
  const model = buildModel(timeline);
  const clip = pointed.clipId
    ? model.clips.find((view) => view.item.id === pointed.clipId)
    : (clipAt(model, RationalTime.toFrames(editor!.playhead, timeline.canvas.rate)) ?? undefined);
  const no = refusal(model, clip, longer);
  if (no || !clip) return [start, ...say(ids, no ?? ''), end];

  const n = clip.number;
  const toolRunId = ids.toolRunId();
  const payload = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    clipId: clip.item.id,
    edge: 'end' as const,
    by: { value: longer ? model.beatFrames : -model.beatFrames, rate: timeline.canvas.rate },
  };
  let startedAt = 0;
  return [
    start,
    ...think(
      ids,
      `Clip ${n} should be a beat ${longer ? 'longer' : 'shorter'}. I’ll move its end by one beat.`,
    ),
    {
      wait: 120,
      event: (at) => {
        startedAt = at;
        // The edit itself: on the bus as the agent, in the run's turn, like the real agent's timeline tool.
        void fake.bus.dispatch(
          TIMELINE_COMMANDS.trimClip,
          payload,
          { source: 'agent', actor: `agent:${runId}` },
          { group: agentTurnGroup(runId) },
        );
        return event('agent.toolStarted', {
          runId,
          toolRunId,
          tool: 'timeline.trimClip',
          sideEffect: 'write',
        })(at);
      },
    },
    {
      wait: 400,
      event: (at) =>
        event('agent.toolFinished', {
          runId,
          toolRunId,
          tool: 'timeline.trimClip',
          status: 'succeeded',
          durationMs: Math.max(0, at - startedAt),
        })(at),
    },
    {
      wait: 20,
      event: (at) => {
        const now = fake.make.timelines.get(timeline.id) ?? timeline;
        const card = (editor ? changesCard(runId, timeline, now) : null) ?? timelineCard(runId, now);
        return event('agent.card', { runId, card })(at);
      },
    },
    ...say(
      ids,
      `Done: clip ${n} is a beat ${longer ? 'longer' : 'shorter'}, and the cuts after it moved with it. ⌘Z puts it back.`,
    ),
    end,
  ];
}
