// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The recorded session's stand-ins for per-run values: home paths and ids. */
import { historyMessages, historyTurn, type AgentEvent } from '@taalcut/agent';
import { newId, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CANONICAL_HOME, createCanonicaliser, scopedCanonicaliser } from '../src/index';

/**
 * A request in an ask that comes after another: the earlier run's call in the history (the agent's own history
 * code cuts it at its fixed length), then this run's comments to answer. `before` is what precedes the clips in
 * that call (a path and a time, in a real run), which moves the cut.
 */
function askAfterAnother(home: string, before: number) {
  const runId = newId<'AgentRun'>() as RunId;
  const clips = Array.from({ length: 30 }, () => newId<'Clip'>());
  const comments = [newId<'Comment'>(), newId<'Comment'>(), newId<'Comment'>()];
  const event = (seq: number, type: string, payload: unknown) =>
    ({ runId, seq, type, v: 1, at: seq, payload }) as AgentEvent;
  const earlier = [
    event(0, 'run.started', {
      conversationId: 'c',
      message: 'Make a video',
      autonomy: 'auto',
      budget: {},
      localOnly: false,
      soulVersion: '1',
      catalogueHash: 'h',
    }),
    event(1, 'tool.requested', {
      toolCallId: 'call',
      modelCallId: 'm',
      modelToolCallId: 't',
      tool: 'library.list',
      callName: 'library_list',
      meta: false,
      input: { folder: `${home}/Desktop/Trip` },
      sideEffect: 'read',
    }),
    event(2, 'tool.completed', {
      toolCallId: 'call',
      output: { kind: 'inline', value: { took: 'x'.repeat(before), clips } },
      cached: false,
      deduplicated: false,
      attempts: 1,
      durationMs: 1,
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    }),
  ];
  const messages = [
    ...historyMessages({ turns: [historyTurn(runId, earlier)!] }),
    { role: 'user', content: 'Answer the comments' },
    { role: 'tool', content: JSON.stringify({ comments: comments.map((id) => ({ id })) }) },
  ];
  return { messages, clips, comments };
}

/** The stand-ins the model saw: this run's comments, and the first clip of the earlier call. */
function standInsOf(messages: readonly unknown[]) {
  const comments = JSON.parse((messages.at(-1) as { content: string }).content).comments.map(
    (c: { id: string }) => c.id,
  );
  const firstClip = /clips\\":\[\\"([0-9A-HJKMNP-TV-Z]{26})/.exec(JSON.stringify(messages))?.[1];
  return { comments, firstClip };
}

describe('canonical values', () => {
  const home = '/private/var/folders/x/T/taalcut-gate-abc/home';

  it('swaps the home folder and ids for stand-ins, in order of appearance, and back', () => {
    const canon = createCanonicaliser(home);
    const [a, b] = [newId<'Source'>(), newId<'Source'>()];
    const sent = [
      { role: 'tool', content: `{"id":"${a}","rootPath":"${home}/Desktop/Trip"} then ${b} and ${a}` },
    ];
    const seen = canon.toCanonical(sent);
    expect(seen[0]?.content).toBe(
      `{"id":"00000000000000000000000001","rootPath":"${CANONICAL_HOME}/Desktop/Trip"} then 00000000000000000000000002 and 00000000000000000000000001`,
    );
    const reply = {
      toolCalls: [
        {
          arguments: { sourceId: '00000000000000000000000002', path: `${CANONICAL_HOME}/Desktop/Trip/a.mov` },
        },
      ],
    };
    expect(canon.fromCanonical(reply)).toEqual({
      toolCalls: [{ arguments: { sourceId: b, path: `${home}/Desktop/Trip/a.mov` } }],
    });
    // A stand-in the model made up maps to nothing, and stays.
    expect(canon.fromCanonical('00000000000000000000000009')).toBe('00000000000000000000000009');
  });

  it('numbers ids per scope: an ask replays the same after other asks, or resumed in a fresh process', () => {
    const scopeOf = (text: string) => /ask (\w+)/.exec(text)?.[1];
    const [a, b, c] = [newId<'Source'>(), newId<'Source'>(), newId<'Source'>()];
    const first = { role: 'user', content: 'ask one' };
    const second = { role: 'user', content: `ask two ${CANONICAL_HOME}` };
    const one = [first, { role: 'tool', content: `${a} ${b}` }];
    const two = [second, { role: 'tool', content: `${c} ${b}` }];
    const id = (n: number) => String(n).padStart(26, '0');

    // Recorded: ask one, then ask two, in one process.
    const recorded = scopedCanonicaliser(home, scopeOf);
    expect(recorded(one).toCanonical(one)[1]?.content).toBe(`${id(1)} ${id(2)}`);
    expect(recorded(two).toCanonical(two)[1]?.content).toBe(`${id(1)} ${id(2)}`);
    // A request naming no ask (a vision call) stays with the ask before.
    const vision = [{ role: 'user', content: `what is in ${b}?` }];
    expect(recorded(vision).fromCanonical(id(2))).toBe(b);

    // Replayed: ask two alone in a fresh process (the home path in its text maps first) numbers the same.
    const fresh = scopedCanonicaliser(home, scopeOf);
    const resumed = [{ role: 'user', content: `ask two ${home}` }, two[1]!];
    expect(fresh(resumed).toCanonical(resumed)[1]?.content).toBe(`${id(1)} ${id(2)}`);
  });

  it('numbers ids the same wherever the history cut falls: after an id, through it, or before it', () => {
    // Recorded on one machine; the model answers the second comment and opens the first clip it saw.
    const recordHome = '/Users/someone/Library/Application Support/Taalcut-test/home';
    const recording = askAfterAnother(recordHome, 0);
    const recorded = standInsOf(createCanonicaliser(recordHome).toCanonical(recording.messages));
    const reply = {
      toolCalls: [{ arguments: { commentId: recorded.comments[1], clipId: recorded.firstClip } }],
    };

    // Replayed on another machine, where every value before the clips has another length: the cut lands at
    // every place in a clip's id and between ids, splitting one, keeping it whole, or dropping it.
    const replayHome = '/private/var/folders/x/T/home';
    let split = 0;
    for (let before = 0; before < 40; before += 1) {
      const run = askAfterAnother(replayHome, before);
      const canon = createCanonicaliser(replayHome);
      const sent = canon.toCanonical(run.messages);
      if (/[0-9A-HJKMNP-TV-Z]{1,25} \[…\]/.test(JSON.stringify(sent))) split += 1;
      // The model sees what it saw when recorded, and the recorded reply reaches this run's comment and clip.
      expect(standInsOf(sent)).toEqual(recorded);
      expect(canon.fromCanonical(reply)).toEqual({
        toolCalls: [{ arguments: { commentId: run.comments[1], clipId: run.clips[0] } }],
      });
    }
    expect(split).toBeGreaterThan(20);
  });

  it('leaves images and provider signatures alone', () => {
    const canon = createCanonicaliser(home);
    const id = newId<'Source'>();
    const image = { type: 'image', data: `${id}+${home}`, mimeType: 'image/jpeg' };
    const thinking = { type: 'thinking', thinking: id, thinkingSignature: id };
    expect(canon.toCanonical([image, thinking])).toEqual([
      image,
      { type: 'thinking', thinking: '00000000000000000000000001', thinkingSignature: id },
    ]);
  });
});
