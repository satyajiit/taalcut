// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A recorded session numbers each request by the model's turns so far (`taalcut_turn`). Once a progress-saving tool
 * has run, the agent shows the turns before it as one note (agent SPEC 34); the note's count keeps the number
 * rising, so a request after a save never matches an earlier request's recording.
 */
import { describe, expect, it } from 'vitest';
import { CONTROL_PREFIX } from '@taalcut/agent';
import { runTurn, type AnthropicMessage } from '../src/anthropic-view';

const ask: AnthropicMessage = { role: 'user', content: 'Make one like my reel.' };
const turn: AnthropicMessage = {
  role: 'assistant',
  content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }],
};
const result: AnthropicMessage = {
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }],
};
const note = (turns: number): AnthropicMessage => ({
  role: 'user',
  content: `${CONTROL_PREFIX} templates.setIntents saved the work of this step's ${turns} earlier turns, so their ${turns} tool calls and results are not shown. Its latest result follows.`,
});

describe('runTurn', () => {
  it('counts the model turns since the run began', () => {
    expect(runTurn([ask, turn, result, turn, result])).toBe(2);
  });

  it('counts the turns a saved-progress note stands for', () => {
    // Seven turns before the save, then the saving turn and one more.
    expect(runTurn([ask, note(7), turn, result, turn, result])).toBe(9);
    expect(runTurn([ask, note(7), turn, result, turn, result])).toBeGreaterThan(
      runTurn([ask, turn, result, turn, result, turn, result]),
    );
  });
});
