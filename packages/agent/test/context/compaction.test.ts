// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1, compaction (SPEC "Compaction"): a prompt over its budget is condensed (read results, finished steps,
 * history, the current step's older turns) and one under it is untouched. The long history is a recorded one: the
 * make flow's longest prompt in the gate demo's session (the stand-in provider, the e2e library), seven steps.
 */
import { readFileSync } from 'node:fs';
import type { RunId } from '@taalcut/core';
import type { ChatMessage } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  compactPrompt,
  estimateTokens,
  KEEP_TURNS,
  promptBudget,
  textTokens,
  type PromptBlock,
} from '../../src/context/compaction';
import { initialState, type RunState } from '../../src/run-state';

interface Fixture {
  readonly system: string;
  readonly blocks: PromptBlock[];
}
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/compaction/make-flow-history.json', import.meta.url), 'utf8'),
) as Fixture;
const tools = ['timeline_get', 'timeline_editText', 'handOff'].map((name) => ({
  name,
  description: `The ${name} tool.`,
  parameters: z.object({ timelineId: z.string() }),
}));

/** The recorded run's state: steps before the last done, each with the handoff its handOff call made. */
function recordedState(blocks: readonly PromptBlock[]): RunState {
  const state = initialState('01RUN0000000000000000000000' as RunId);
  const steps = Math.max(...blocks.flatMap((b) => (b.step === undefined ? [] : [b.step]))) + 1;
  state.plan = Array.from({ length: steps }, (_, index) => {
    const handOff = blocks
      .filter((b) => b.step === index && b.kind === 'turn')
      .flatMap((b) => b.messages)
      .flatMap((m) => (m.role === 'assistant' ? m.parts : []))
      .find((p) => p.type === 'tool_call' && p.call.name === 'handOff');
    const output = handOff?.type === 'tool_call' ? handOff.call.arguments : undefined;
    return {
      id: `f${index + 1}`,
      text: `step ${index + 1}`,
      skill: `skill.${index + 1}`,
      status: index < steps - 1 ? 'done' : 'doing',
      turns: 1,
      verifyRetries: 0,
      ended: false,
      summary: '',
      ...(output ? { handedOff: { output, refs: [], at: 0 } } : {}),
    };
  });
  state.stepIndex = steps - 1;
  return state;
}

const flat = (blocks: readonly PromptBlock[]) => blocks.flatMap((b) => b.messages);
const text = (m: ChatMessage) =>
  m.role === 'assistant' ? '' : typeof m.content === 'string' ? m.content : '';
const run = (budget: number, blocks = fixture.blocks) =>
  compactPrompt({ blocks, state: recordedState(blocks), system: fixture.system, tools, budget });
const whole = estimateTokens(fixture.system, tools, flat(fixture.blocks));

describe('the estimate', () => {
  it('counts digits and JSON as Qwen does, closer than one rate (z1: 23.4k estimated, 31.3k counted)', () => {
    const cut = (at: number) => ({
      index: at,
      start: { value: at * 1_001, rate: 30_000 },
      id: '01M6AE82ZRH6J3G39ZD69WVJPF',
    });
    const page = JSON.stringify(Array.from({ length: 40 }, (_, at) => cut(at)));
    // Dense JSON: under two characters a token. Prose: about four.
    expect(page.length / textTokens(page)).toBeLessThan(2);
    const prose =
      'Write what the shot does so it fits anyone footage: its role, who is in it and what they do.';
    expect(prose.length / textTokens(prose)).toBeGreaterThan(3.5);
  });
});

describe('compaction on a long recorded history', () => {
  it('leaves a prompt under its budget alone', () => {
    expect(whole).toBeGreaterThan(8_000);
    expect(run(whole)).toBeUndefined();
    expect(promptBudget(32_768)).toBe(Math.floor(32_768 * 0.9) - 4_096);
  });

  it('condenses read results first, the biggest first, and keeps the last turns whole', () => {
    const budget = whole - 1_000;
    const compacted = run(budget)!;
    expect(compacted.fits).toBe(true);
    expect(compacted.afterTokens).toBeLessThanOrEqual(budget);
    expect(compacted.condensedResults).toBeGreaterThan(0);
    expect(compacted.summarisedSteps).toBe(0);
    const condensed = compacted.messages.filter((m) => text(m).includes('Condensed: this'));
    // The cast's long result (3,495 characters) goes first.
    expect(text(condensed[0]!)).toContain('Condensed: this timeline_cast result');
    const turns = fixture.blocks.filter((b) => b.kind === 'turn');
    for (const block of turns.slice(-2))
      for (const message of block.messages) expect(compacted.messages).toContainEqual(message);
    expect(compacted.messages[0]).toEqual(fixture.blocks[0]!.messages[0]);
  });

  it('then folds finished steps into one line each, with their handoffs', () => {
    const compacted = run(Math.floor(whole / 2))!;
    expect(compacted.summarisedSteps).toBeGreaterThan(0);
    const lines = compacted.messages
      .map(text)
      .filter((t) => /Step \d+ \(the skill\.\d+ skill\) is done/.test(t));
    expect(lines.length).toBe(compacted.summarisedSteps);
    expect(lines[0]).toContain('it handed off {');
    // Every note of the current step stays.
    const current = recordedState(fixture.blocks).stepIndex;
    for (const block of fixture.blocks.filter((b) => b.step === current && b.kind === 'control'))
      expect(compacted.messages).toContainEqual(block.messages[0]);
  });

  it('is the same prompt from the same history and budget', () => {
    expect(run(3_000)).toEqual(run(3_000));
  });
});

describe('the current step’s older turns', () => {
  const call = (id: string, tool: string): ChatMessage => ({
    role: 'assistant',
    parts: [{ type: 'tool_call', call: { id, name: tool, arguments: { intents: 'x'.repeat(3_000) } } }],
    provider: 'p',
    model: 'm',
  });
  const result = (id: string, tool: string, error?: string): ChatMessage => ({
    role: 'tool',
    toolCallId: id,
    toolName: tool,
    content: error ? `Error ${error}: refused` : '{"written":4}',
    ...(error ? { isError: true } : {}),
  });
  /** Ten retried pages: refusals of 1,000 tokens each, as MLX1's m4 sent, then the call that worked. */
  const retried: PromptBlock[] = [
    { kind: 'user', messages: [{ role: 'user', content: 'Copy this reel' }] },
    { kind: 'control', step: 0, messages: [{ role: 'user', content: '[Taalcut] Skill input: {}' }] },
    ...Array.from({ length: 10 }, (_, i): PromptBlock => {
      const id = `c${i}`;
      const failed = i < 9;
      return {
        kind: 'turn',
        step: 0,
        messages: [call(id, 'setIntents'), result(id, 'setIntents', failed ? 'core.validation' : undefined)],
        calls: [{ tool: 'setIntents', ...(failed ? { failed: 'core.validation' } : {}) }],
      };
    }),
  ];

  it('drops superseded refusals into one note and keeps the last turns and the step’s notes', () => {
    const budget = 6_000;
    const compacted = compactPrompt({
      blocks: retried,
      state: { ...initialState('01RUN0000000000000000000000' as RunId), stepIndex: 0 },
      system: 'You are the Analyst.',
      tools,
      budget,
    })!;
    expect(compacted.fits).toBe(true);
    expect(compacted.droppedTurns).toBeGreaterThan(0);
    expect(compacted.droppedTurns).toBeLessThanOrEqual(10 - KEEP_TURNS);
    const note = compacted.messages.find((m) =>
      text(m).includes('earlier turn(s) of this step are not shown'),
    );
    expect(text(note!)).toContain('setIntents (refused: core.validation)');
    expect(compacted.messages.slice(0, 2)).toEqual(flat(retried.slice(0, 2)));
    expect(compacted.messages.slice(-2 * KEEP_TURNS)).toEqual(flat(retried.slice(-KEEP_TURNS)));
  });
});
