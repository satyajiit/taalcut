// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  agentRunStartedSchema,
  CHAT_EFFORTS,
  chatContract,
  effectiveEffort,
  effortAvailable,
  effortOfReasoning,
  effortReasoning,
  type ChatEffort,
  type ReasoningLevel,
} from '../src/index';

/** pi-ai 1.1.0's getSupportedThinkingLevels for models the profiles use (the models package checks the real ones). */
const OPENAI_GPT_5: ReasoningLevel[] = ['off', 'low', 'medium', 'high', 'xhigh'];
const CLAUDE_SONNET_5: ReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_OPUS: ReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const GEMINI_FLASH: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];
const NO_THINKING: ReasoningLevel[] = ['off'];

const map = (supported: ReasoningLevel[]) =>
  Object.fromEntries(CHAT_EFFORTS.map((effort) => [effort, effortReasoning(effort, supported)]));

describe('chat effort', () => {
  it('maps each effort onto the levels a model has', () => {
    expect(map(OPENAI_GPT_5)).toEqual({ quick: 'low', balanced: 'medium', deep: 'high', max: 'xhigh' });
    expect(map(CLAUDE_SONNET_5)).toEqual({ quick: 'low', balanced: 'medium', deep: 'high', max: 'max' });
    expect(map(CLAUDE_OPUS)).toEqual({ quick: 'low', balanced: 'medium', deep: 'high', max: 'max' });
    // Gemini has no level past high: Max runs as Deep.
    expect(map(GEMINI_FLASH)).toEqual({ quick: 'low', balanced: 'medium', deep: 'high', max: 'high' });
    // A model that doesn't think gets 'off' whatever is asked.
    expect(map(NO_THINKING)).toEqual({ quick: 'off', balanced: 'off', deep: 'off', max: 'off' });
    expect(effortReasoning('deep', [])).toBe('off');
  });

  it('says which efforts a model offers, and what an unavailable one runs as', () => {
    const offered = (supported: ReasoningLevel[]) =>
      CHAT_EFFORTS.filter((effort) => effortAvailable(effort, supported));
    expect(offered(OPENAI_GPT_5)).toEqual(['quick', 'balanced', 'deep', 'max']);
    expect(offered(GEMINI_FLASH)).toEqual(['quick', 'balanced', 'deep']);
    expect(offered(NO_THINKING)).toEqual(['quick']);
    expect(effectiveEffort('max', GEMINI_FLASH)).toBe('deep');
    expect(effectiveEffort('deep', NO_THINKING)).toBe('quick');
    expect(effectiveEffort('balanced', OPENAI_GPT_5)).toBe('balanced');
  });

  it('reads a profile’s reasoning level as the effort it shows by default', () => {
    const cases: [ReasoningLevel | undefined, ChatEffort][] = [
      [undefined, 'quick'],
      ['off', 'quick'],
      ['minimal', 'quick'],
      ['low', 'quick'],
      ['medium', 'balanced'],
      ['high', 'deep'],
      ['xhigh', 'max'],
      ['max', 'max'],
    ];
    for (const [level, effort] of cases) expect(effortOfReasoning(level)).toBe(effort);
  });

  it('chat.send takes an effort and refuses an unknown one', () => {
    const input = chatContract.send['~orpc'].inputSchema!;
    const conversationId = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    expect(input['~standard'].validate({ conversationId, text: 'Hi', effort: 'deep' })).toMatchObject({
      value: { effort: 'deep' },
    });
    const refused = input['~standard'].validate({ conversationId, text: 'Hi', effort: 'turbo' });
    expect('issues' in (refused as object)).toBe(true);
  });

  it('carries the exact level a chat picked, one of the reasoning levels, on chat.send and run.started', () => {
    const input = chatContract.send['~orpc'].inputSchema!;
    const conversationId = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    expect(input['~standard'].validate({ conversationId, text: 'Hi', reasoning: 'xhigh' })).toMatchObject({
      value: { reasoning: 'xhigh' },
    });
    const refused = input['~standard'].validate({ conversationId, text: 'Hi', reasoning: 'ultra' });
    expect('issues' in (refused as object)).toBe(true);
    const runId = '01JABCDEFGHJKMNPQRSTVWXYZ1';
    expect(agentRunStartedSchema.parse({ runId, conversationId, reasoning: 'max' })).toMatchObject({
      reasoning: 'max',
    });
  });
});
