// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-TOOLGROUPS: consecutive calls to one tool show as one row ("Inspect 11 clips"). The grouping is a pure function
// over the run's calls (groupToolRuns), so a chat replayed from history groups exactly as it did live. These tests run
// the events through the transcript's own fold, in the order a live run sends them and in the order stored history
// gives them back (packages/library/src/chat/history.ts: each call's start and finish together).
import { newId, type ChatEvent, type ChatHistoryEvent, type RunId, type ToolRunId } from '@taalcut/core';
import { groupToolRuns, tallyToolRuns, TOOL_GROUP_SAMPLES, type ToolRunEntry } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { inspectClips, settle } from '../src/chat/fake-script';
import { finishRun, replay, type Transcript } from '../src/chat/transcript';
import { transcriptRows } from '../src/chat/transcript-rows';

const RUN = newId<'AgentRun'>() as RunId;
const CONVERSATION = newId<'Conversation'>();
const T0 = 1_760_000_000_000;

type Call = { id: ToolRunId; tool: string; failed?: boolean; summary?: string };
const calls = (tool: string, count: number, failing: number[] = []): Call[] =>
  Array.from({ length: count }, (_, index) => ({
    id: newId<'ToolRun'>() as ToolRunId,
    tool,
    ...(failing.includes(index) ? { failed: true } : {}),
  }));

const started = ({ id, tool }: Call, at: number): ChatEvent => ({
  type: 'agent.toolStarted',
  at,
  payload: { runId: RUN, toolRunId: id, tool, sideEffect: 'read' },
});
const finished = ({ id, tool, failed, summary }: Call, at: number): ChatEvent => ({
  type: 'agent.toolFinished',
  at,
  payload: {
    runId: RUN,
    toolRunId: id,
    tool,
    status: failed ? 'failed' : 'succeeded',
    durationMs: 400,
    ...(failed
      ? { error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true } }
      : {}),
    ...(summary ? { summary } : {}),
  },
});
const runStarted: ChatEvent = {
  type: 'agent.runStarted',
  at: T0,
  payload: { runId: RUN, conversationId: CONVERSATION },
};
const runFinished = (at: number): ChatEvent => ({
  type: 'agent.runFinished',
  at,
  payload: { runId: RUN, status: 'succeeded' },
});

/** As a live run sends them: every call starts at once, then they finish in their own order. */
function live(list: readonly Call[]): ChatEvent[] {
  const order = [...list].reverse();
  return [
    runStarted,
    ...list.map((call, index) => started(call, T0 + 10 + index)),
    ...order.map((call, index) => finished(call, T0 + 500 + index * 30)),
    runFinished(T0 + 2_000),
  ];
}

/** As stored history gives them back: each call's start, then its finish. */
function history(list: readonly Call[]): ChatHistoryEvent[] {
  return [
    runStarted,
    ...list.flatMap((call, index) => [started(call, T0 + 10 + index), finished(call, T0 + 500 + index * 30)]),
    runFinished(T0 + 2_000),
  ];
}

/** What each run block shows: its rows of calls, a group as its tool, size and tally. */
function shown(transcript: Transcript) {
  return transcriptRows(transcript.items).flatMap((row) =>
    row.kind === 'run' ? [groupToolRuns(row.tools).map(describeEntry)] : [],
  );
}
function describeEntry(entry: ToolRunEntry) {
  if (entry.kind === 'call') return { call: entry.call.card.tool, status: entry.call.card.status };
  const { total, done, failed, running, status } = tallyToolRuns(entry.calls);
  return { group: entry.tool, key: entry.key, total, done, failed, running, status };
}

describe('grouped calls in the transcript', () => {
  it('a chat replayed from history groups exactly as it did live', () => {
    const list = calls('library.getAsset', 11, [6]);
    const fromLive = shown(replay(live(list)));
    expect(fromLive).toEqual([
      [
        {
          group: 'library.getAsset',
          key: list[0]!.id,
          total: 11,
          done: 10,
          failed: 1,
          running: 0,
          status: 'failed',
        },
      ],
    ]);
    expect(shown(replay(history(list)))).toEqual(fromLive);
  });

  it('is one group from the moment the second call starts, running until the last one ends', () => {
    const list = calls('library.getAsset', 11);
    const events = live(list);
    let transcript = replay(events.slice(0, 2));
    expect(shown(transcript)).toEqual([[{ call: 'library.getAsset', status: 'running' }]]);
    // Event by event, as the stream applies them: the first call's row becomes the group, under the same key.
    for (const event of events.slice(2, 12)) transcript = replay([event], transcript);
    expect(shown(transcript)).toEqual([
      [
        {
          group: 'library.getAsset',
          key: list[0]!.id,
          total: 11,
          done: 0,
          failed: 0,
          running: 11,
          status: 'running',
        },
      ],
    ]);
    for (const event of events.slice(12, 16)) transcript = replay([event], transcript);
    expect(shown(transcript)[0]?.[0]).toMatchObject({ done: 4, running: 7, status: 'running' });
  });

  it('keeps a lone call as a call', () => {
    const list = calls('media.probe', 1);
    expect(shown(replay(history(list)))).toEqual([[{ call: 'media.probe', status: 'succeeded' }]]);
  });

  it('never groups two tools that take turns', () => {
    const [a, b] = [calls('library.getAsset', 2), calls('vision.describeFrame', 2)];
    const list = [a[0]!, b[0]!, a[1]!, b[1]!];
    expect(shown(replay(history(list)))).toEqual([
      [
        { call: 'library.getAsset', status: 'succeeded' },
        { call: 'vision.describeFrame', status: 'succeeded' },
        { call: 'library.getAsset', status: 'succeeded' },
        { call: 'vision.describeFrame', status: 'succeeded' },
      ],
    ]);
  });

  it('keeps a failure inside a group countable and its error on its card', () => {
    const list = calls('library.getAsset', 5, [1, 3]);
    const transcript = replay(history(list));
    const row = transcriptRows(transcript.items).find((r) => r.kind === 'run');
    const [entry] = groupToolRuns(row?.kind === 'run' ? row.tools : []);
    expect(entry?.kind).toBe('group');
    const failed = entry?.kind === 'group' ? entry.calls.filter(({ card }) => card.status === 'failed') : [];
    expect(failed.map(({ card }) => [card.id, card.error?.code])).toEqual([
      [list[1]!.id, 'core.timeout'],
      [list[3]!.id, 'core.timeout'],
    ]);
  });

  it('keeps one activity block when the agent speaks between calls in the same run', () => {
    const [first, second] = [calls('library.getAsset', 2), calls('library.getAsset', 2)];
    const words: ChatEvent = {
      type: 'agent.messageDelta',
      at: T0 + 300,
      payload: { runId: RUN, messageId: newId<'Message'>(), delta: 'Two more.' },
    };
    const events = [...history(first).slice(0, -1), words, ...history(second).slice(1)];
    expect(
      shown(replay(events)).map((block) => block.map((entry) => 'total' in entry && entry.total)),
    ).toEqual([[4]]);
  });

  it('a stopped run leaves no call running in its group', () => {
    const list = calls('library.getAsset', 4);
    const events = live(list).slice(0, 7); // all four started, two finished
    const transcript = finishRun(replay(events), RUN, 'cancelled', T0 + 900);
    expect(shown(transcript)[0]?.[0]).toMatchObject({ total: 4, done: 2, running: 0, status: 'cancelled' });
  });

  it('the fake chat’s inspect run shows two groups: eleven clips, one failed, then three frames', () => {
    const ids = {
      runId: RUN,
      conversationId: CONVERSATION,
      messageId: newId<'Message'>(),
      toolRunId: () => newId<'ToolRun'>() as ToolRunId,
    };
    const blocks = shown(replay(settle(inspectClips(ids), T0).events));
    expect(blocks).toHaveLength(1);
    expect(
      blocks[0]?.map((entry) => ('group' in entry ? [entry.group, entry.total, entry.failed] : entry)),
    ).toEqual([
      ['library.getAsset', 11, 1],
      ['vision.describeFrame', 3, 0],
    ]);
  });
});

/** Each call's summary, as its row in the opened group shows it, in the order the calls started. */
function summaries(transcript: Transcript) {
  return transcriptRows(transcript.items).flatMap((row) =>
    row.kind === 'run'
      ? groupToolRuns(row.tools).flatMap((entry) =>
          (entry.kind === 'group' ? entry.calls : [entry.call]).map(({ card }) => card.summary),
        )
      : [],
  );
}

describe('each grouped call says what it was about', () => {
  const said = (list: Call[]) =>
    list.map((call) => (call.failed ? call : { ...call, summary: `${call.id}.MOV` }));

  it('from agent.toolFinished’s summary, live and from history alike; a failed call says nothing', () => {
    const list = said(calls('library.getAsset', 5, [2]));
    const expected = list.map((call) => call.summary);
    expect(expected[2]).toBeUndefined();
    expect(summaries(replay(live(list)))).toEqual(expected);
    expect(summaries(replay(history(list)))).toEqual(expected);
  });

  it('keeps a call without one as it was', () => {
    expect(summaries(replay(history(calls('library.getAsset', 3))))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('the fake chat’s inspect run names each clip as library.getAsset does, and each frame by its time', () => {
    const ids = {
      runId: RUN,
      conversationId: CONVERSATION,
      messageId: newId<'Message'>(),
      toolRunId: () => newId<'ToolRun'>() as ToolRunId,
    };
    const shownSummaries = summaries(replay(settle(inspectClips(ids), T0).events));
    const clips = TOOL_GROUP_SAMPLES.map((sample, index) => (index === 6 ? undefined : sample));
    expect(shownSummaries).toEqual([
      ...clips,
      'IMG_0412.MOV · 0:12',
      'IMG_0413.MOV · 0:04',
      'IMG_0433.MOV · 0:06',
    ]);
  });
});
