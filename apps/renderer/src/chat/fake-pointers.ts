// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake agent's reference pointers (P3-V15, round P3-3): the places a message's words point at ("at 0:04",
 * "clip 2"), resolved against the video the message is about, as the agent sets them on `agent.runStarted` and on
 * the stored message. The video is the one a clip chip points at, else the conversation's project's newest; words
 * it can't place are an `unresolved` pointer (the chat shows "Not found"), never a guess.
 */
import {
  RationalTime,
  TimeRange,
  type ConversationId,
  type ProjectId,
  type ReferencePointer,
  type SelectionChip,
  type Timeline,
} from '@taalcut/core';
import { buildModel, fpsOf, type TimelineModel } from '../features/timeline/model';
import type { Beat } from './fake-script';

const CLOCK = /\b(?:at\s+)?(\d{1,2}):([0-5]\d)\b/gi;
const CLIP = /\b(?:clip|shot)\s+(\d{1,3})\b/gi;
/** Core's cap: a message carries at most ten pointers. */
const MAX_POINTERS = 10;

interface Said {
  readonly said: string;
  readonly index: number;
  readonly place: (model: TimelineModel, timeline: Timeline) => ReferencePointer | null;
}

const unresolved = (said: string): ReferencePointer => ({
  said,
  basis: 'timeline',
  kind: 'unresolved',
  templateId: null,
  timelineId: null,
  slotId: null,
  slotNumber: null,
  clipId: null,
  range: null,
});

/** "at 0:04": the clip under that moment, from that moment. */
function atClock(said: string, minutes: number, seconds: number) {
  return (model: TimelineModel, timeline: Timeline): ReferencePointer | null => {
    const frame = Math.round((minutes * 60 + seconds) * fpsOf(model.rate));
    const clip = model.clips.find((view) => view.start <= frame && frame < view.end);
    if (!clip) return null;
    return {
      ...unresolved(said),
      kind: 'clip',
      timelineId: timeline.id,
      clipId: clip.item.id,
      slotNumber: clip.number,
      range: TimeRange.of(RationalTime.of(frame, model.rate), RationalTime.of(0, model.rate)),
    };
  };
}

/** "clip 2": that clip, over its whole span. */
function clipNumber(said: string, number: number) {
  return (model: TimelineModel, timeline: Timeline): ReferencePointer | null => {
    const clip = model.clips.find((view) => view.number === number);
    if (!clip) return null;
    return {
      ...unresolved(said),
      kind: 'clip',
      timelineId: timeline.id,
      clipId: clip.item.id,
      slotNumber: clip.number,
      range: TimeRange.of(
        RationalTime.of(clip.start, model.rate),
        RationalTime.of(clip.end - clip.start, model.rate),
      ),
    };
  };
}

function phrases(text: string): Said[] {
  const found: Said[] = [];
  for (const match of text.matchAll(CLOCK))
    found.push({
      said: match[0].slice(0, 80),
      index: match.index,
      place: atClock(match[0].slice(0, 80), Number(match[1]), Number(match[2])),
    });
  for (const match of text.matchAll(CLIP))
    found.push({
      said: match[0].slice(0, 80),
      index: match.index,
      place: clipNumber(match[0].slice(0, 80), Number(match[1])),
    });
  return found.sort((a, b) => a.index - b.index).slice(0, MAX_POINTERS);
}

/**
 * The video the message is about: a clip chip's, else the newest of the chat's project (the conversation's own
 * link, or the project whose chat this is: the editor's dock).
 */
function videoFor(chat: ChatAbout, selections: readonly SelectionChip[]): Timeline | undefined {
  const make = window.taalcutFake?.make;
  if (!make) return undefined;
  for (const chip of selections)
    if (chip.kind === 'clip' || chip.kind === 'range') {
      const pointed = make.timelines.get(chip.timelineId);
      if (pointed) return pointed;
    }
  const projectId =
    chat.projectId ??
    make.projects.list(false, 200).items.find((project) => project.conversationId === chat.conversationId)
      ?.id;
  if (!projectId) return undefined;
  return make.timelines
    .all()
    .filter((timeline) => timeline.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** The conversation a message went to, and the project it is linked to (null: none). */
export interface ChatAbout {
  readonly conversationId: ConversationId;
  readonly projectId: ProjectId | null;
}

/** The message's pointers, in the order its words came; empty when it names no time or clip. */
export function fakePointers(
  text: string,
  chat: ChatAbout,
  selections: readonly SelectionChip[],
): ReferencePointer[] {
  const said = phrases(text);
  if (said.length === 0) return [];
  const timeline = videoFor(chat, selections);
  const model = timeline ? buildModel(timeline) : null;
  return said.map((phrase) =>
    timeline && model ? (phrase.place(model, timeline) ?? unresolved(phrase.said)) : unresolved(phrase.said),
  );
}

/** The run starts with the pointers the agent resolved from the message, so its chips show while it runs. */
export function withPointers(beats: Beat[], pointers: readonly ReferencePointer[]): Beat[] {
  if (pointers.length === 0) return beats;
  return beats.map((beat) => ({
    ...beat,
    event: (at) => {
      const event = beat.event(at);
      return event.type === 'agent.runStarted'
        ? { ...event, payload: { ...event.payload, pointers: [...pointers] } }
        : event;
    },
  }));
}
