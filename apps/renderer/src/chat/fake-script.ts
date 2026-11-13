// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model output: data, never translated */

import type {
  Card,
  ConversationId,
  MessageId,
  RunId,
  ToolRunId,
  ChatEvent,
  ChatHistoryEvent,
} from '@taalcut/core';
import { TOOL_GROUP_SAMPLES } from '@taalcut/ui';

/**
 * The fake agent's scripts. A script is a list of beats: wait, then emit one
 * event. The gate demo (P1-H3 "Done when") is the one that matters: add a
 * source, probe a video, describe a frame, then answer in a streamed message.
 */

export interface Beat {
  /** Milliseconds after the previous beat, at speed 1. */
  wait: number;
  event: (at: number) => ChatEvent;
}

export interface ScriptIds {
  runId: RunId;
  conversationId: ConversationId;
  messageId: MessageId;
  toolRunId: () => ToolRunId;
}

export const GATE_DEMO_PROMPT = "Add my Desktop/Trip folder and tell me what's in the first video";

const REASONING =
  'You want the Trip folder in your library and a look at its first video. ' +
  'I will add the folder as a source, check the first video, then look at one frame and describe it.';

const ANSWER =
  'I added your Trip folder: 14 videos and 32 photos. The first video, IMG_0412.MOV, is 48 seconds of 4K ' +
  'footage with sound. At 0:12 it shows a beach at sunset: two people walk along the waterline while the ' +
  'camera pans slowly to the right. It would make a calm opening shot for a travel reel.';

/** Splits text into word-sized chunks, the way a model streams it. */
export function chunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

export function event<T extends ChatEvent['type']>(
  type: T,
  payload: Extract<ChatEvent, { type: T }>['payload'],
): (at: number) => ChatEvent {
  return (at) => ({ type, at, payload }) as ChatEvent;
}

function tool(
  ids: ScriptIds,
  name: string,
  sideEffect: 'read' | 'write',
  workMs: number,
  summary: string,
  stepId?: string,
): Beat[] {
  const toolRunId = ids.toolRunId();
  const { runId } = ids;
  let startedAt = 0;
  const step = (status: 'running' | 'done'): Beat[] =>
    stepId === undefined
      ? []
      : [{ wait: status === 'running' ? 120 : 40, event: event('agent.step', { runId, stepId, status }) }];
  return [
    ...step('running'),
    {
      wait: 80,
      event: (at) => {
        startedAt = at;
        return event('agent.toolStarted', { runId, toolRunId, tool: name, sideEffect })(at);
      },
    },
    {
      wait: workMs,
      event: (at) =>
        event('agent.toolFinished', {
          runId,
          toolRunId,
          tool: name,
          status: 'succeeded',
          durationMs: Math.max(0, at - startedAt),
        })(at),
    },
    {
      wait: 20,
      event: (at) =>
        event('agent.card', {
          runId,
          card: {
            type: 'toolRun',
            id: toolRunId,
            version: 1,
            runId,
            toolRunId,
            tool: name,
            status: 'succeeded',
            startedAt,
            finishedAt: at,
            summary,
          } satisfies Card,
        })(at),
    },
    ...step('done'),
  ];
}

export function stream(
  ids: Pick<ScriptIds, 'runId' | 'messageId'>,
  text: string,
  type: 'agent.messageDelta' | 'agent.reasoningDelta',
  wait: number,
) {
  const { runId, messageId } = ids;
  return chunks(text).map((delta): Beat => ({
    wait,
    event:
      type === 'agent.messageDelta'
        ? event('agent.messageDelta', { runId, messageId, delta })
        : event('agent.reasoningDelta', { runId, delta }),
  }));
}

/** "Add my Desktop/Trip folder and tell me what's in the first video." */
export function gateDemo(ids: ScriptIds): Beat[] {
  const { runId, conversationId } = ids;
  return [
    { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
    ...stream(ids, REASONING, 'agent.reasoningDelta', 35),
    {
      wait: 150,
      event: event('agent.plan', {
        runId,
        steps: [
          { id: 'add', text: 'Add the Desktop/Trip folder to your library', status: 'pending' },
          { id: 'probe', text: 'Check the first video', status: 'pending' },
          { id: 'look', text: 'Look at a frame and describe it', status: 'pending' },
        ],
      }),
    },
    ...tool(ids, 'library.addSource', 'write', 700, 'Added Trip: 14 videos and 32 photos.', 'add'),
    ...tool(
      ids,
      'media.probe',
      'read',
      500,
      'IMG_0412.MOV: 48 seconds of 4K video at 30 fps, with sound.',
      'probe',
    ),
    ...tool(
      ids,
      'vision.describeFrame',
      'read',
      900,
      'Frame at 0:12: a beach at sunset, two people walking.',
      'look',
    ),
    ...stream(ids, ANSWER, 'agent.messageDelta', 45),
    { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) },
  ];
}

export const INSPECT_PROMPT = 'Which of my newest clips are from the beach?';

const INSPECT_ANSWER =
  'Three of your newest clips are on the beach: IMG_0412 at sunset, IMG_0413 with the waves on the rocks and ' +
  'IMG_0433 with the footprints. I couldn’t read IMG_0424 in time, so it isn’t counted.';

/**
 * "Which of my newest clips are from the beach?" (FIX-TOOLGROUPS): the agent inspects eleven clips at once, as in
 * the owner's run, and one read times out; then it looks at three frames, one after another. The chat shows two
 * grouped rows, "Inspect 11 clips" and "Look at 3 frames", with the failed call shown under the first.
 */
export function inspectClips(ids: ScriptIds): Beat[] {
  const { runId, conversationId } = ids;
  const calls = TOOL_GROUP_SAMPLES.map((summary) => ({ toolRunId: ids.toolRunId(), summary, startedAt: 0 }));
  const failing = 6;
  const started = calls.map((call, index): Beat => ({
    wait: index === 0 ? 150 : 15,
    event: (at) => {
      call.startedAt = at;
      const payload = {
        runId,
        toolRunId: call.toolRunId,
        tool: 'library.getAsset',
        sideEffect: 'read' as const,
      };
      return event('agent.toolStarted', payload)(at);
    },
  }));
  const finished = calls.flatMap((call, index): Beat[] => {
    const { toolRunId, summary } = call;
    const durationMs = (at: number) => Math.max(0, at - call.startedAt);
    const base = { runId, toolRunId, tool: 'library.getAsset' };
    if (index === failing) {
      const fix = { command: 'agent.retryStep', labelKey: 'fix.retry', payload: { toolRunId } };
      const error = { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true, fix };
      return [
        {
          wait: 260,
          event: (at) =>
            event('agent.toolFinished', { ...base, status: 'failed', durationMs: durationMs(at), error })(at),
        },
      ];
    }
    // As the real agent sends it: the call's summary, from the tool's describeCall, on its toolFinished.
    return [
      {
        wait: 180 + (index % 3) * 60,
        event: (at) =>
          event('agent.toolFinished', { ...base, status: 'succeeded', durationMs: durationMs(at), summary })(
            at,
          ),
      },
    ];
  });
  return [
    { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
    ...stream(
      ids,
      'I will check your eleven newest clips at once, then look at the beach ones.',
      'agent.reasoningDelta',
      30,
    ),
    ...started,
    ...finished,
    // The file and the frame's time: a summary never says what the model saw.
    ...tool(ids, 'vision.describeFrame', 'read', 400, 'IMG_0412.MOV · 0:12'),
    ...tool(ids, 'vision.describeFrame', 'read', 400, 'IMG_0413.MOV · 0:04'),
    ...tool(ids, 'vision.describeFrame', 'read', 400, 'IMG_0433.MOV · 0:06'),
    ...stream(ids, INSPECT_ANSWER, 'agent.messageDelta', 40),
    { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) },
  ];
}

/** Anything else: the preview can't do it yet, and says so. */
export function fallbackReply(ids: ScriptIds): Beat[] {
  const { runId, conversationId } = ids;
  return [
    { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
    ...stream(ids, 'This is the preview agent. It knows one task so far.', 'agent.reasoningDelta', 35),
    ...stream(
      ids,
      `The real agent isn't connected yet, so I can only run the demo. Try: “${GATE_DEMO_PROMPT}”.`,
      'agent.messageDelta',
      40,
    ),
    { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) },
  ];
}

const ANSWERS = {
  approve: 'Thanks. The preview agent stops here; the real agent carries on from this point.',
  remember: 'Thanks. I won’t ask again before sending files to the cloud for this kind of job.',
  deny: 'Okay, I won’t do that. Tell me if you want something else instead.',
};

/**
 * An answered approval, consent or cost estimate: the run picks up again,
 * settles the card in place (same id) and says what happens next.
 */
export function answerScript(
  ids: Pick<ScriptIds, 'runId' | 'conversationId' | 'messageId'>,
  settled: Card,
  decision: 'approve' | 'deny',
  remember: boolean,
): Beat[] {
  const { runId, conversationId } = ids;
  const reply = decision === 'deny' ? ANSWERS.deny : remember ? ANSWERS.remember : ANSWERS.approve;
  return [
    { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
    { wait: 0, event: event('agent.card', { runId, card: settled }) },
    ...stream(ids, reply, 'agent.messageDelta', 40),
    { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) },
  ];
}

export function scriptFor(text: string, ids: ScriptIds): Beat[] {
  if (/trip|folder|first video/i.test(text)) return gateDemo(ids);
  return /\binspect\b|\bbeach\b/i.test(text) ? inspectClips(ids) : fallbackReply(ids);
}

/** Lays a script out in time with no waiting: for seeded history. */
export function settle(beats: readonly Beat[], start: number): { events: ChatHistoryEvent[]; end: number } {
  let at = start;
  const events = beats.map((beat) => {
    at += beat.wait;
    return beat.event(at);
  });
  return { events, end: at };
}
