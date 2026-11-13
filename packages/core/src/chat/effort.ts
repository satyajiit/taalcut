// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How hard the agent thinks before it answers, as the chat offers it: four
 * plain levels instead of pi-ai's seven reasoning settings. A chat sends its
 * effort with each message (chat.send); the run logs it (run.started) and the
 * ModelClient turns it into a reasoning level for each model it calls, from
 * the levels that model supports (pi-ai's getSupportedThinkingLevels), so a
 * fallback to another provider still gets the nearest level it has.
 *
 * Pure, so the agent, the models package and the renderer agree on what is
 * available and what is sent.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { REASONING_LEVELS, type ReasoningLevel } from '../ports/model-ports';

export const CHAT_EFFORTS = ['quick', 'balanced', 'deep', 'max'] as const;
export type ChatEffort = (typeof CHAT_EFFORTS)[number];
export const chatEffortSchema = z.enum(CHAT_EFFORTS);

/**
 * UX3-AGT: the exact thinking level a chat picked, one of its model's own (the composer lists the provider's
 * official levels, e.g. OpenAI's none to max). It replaces `effort` when both are sent: the model it was picked
 * for runs at it, and a fallback model runs at the nearest level it has (pi-ai's clampThinkingLevel).
 */
export const chatThinkingSchema = z.enum(REASONING_LEVELS);

/** The reasoning levels each effort asks for, preferred first. */
export const EFFORT_REASONING: Readonly<Record<ChatEffort, readonly ReasoningLevel[]>> = {
  // Thinks a little: 'off' only where the model has no lighter setting (it doesn't think at all).
  quick: ['low', 'minimal', 'off'],
  balanced: ['medium'],
  deep: ['high'],
  // Anthropic calls its deepest level max, OpenAI xhigh; Gemini has neither, so it has no Max.
  max: ['max', 'xhigh'],
};

const rank = (level: ReasoningLevel) => REASONING_LEVELS.indexOf(level);

/** Whether a model with these reasoning levels has a setting for this effort. */
export function effortAvailable(effort: ChatEffort, supported: readonly ReasoningLevel[]): boolean {
  return EFFORT_REASONING[effort].some((level) => supported.includes(level));
}

/**
 * The reasoning level to send for an effort to a model with these levels.
 * When the model has none of the effort's levels (a fallback model, say), the
 * deepest level below the effort; failing that the lightest it has; 'off'
 * when it lists none.
 */
export function effortReasoning(effort: ChatEffort, supported: readonly ReasoningLevel[]): ReasoningLevel {
  const preferred = EFFORT_REASONING[effort].find((level) => supported.includes(level));
  if (preferred) return preferred;
  const ceiling = Math.min(...EFFORT_REASONING[effort].map(rank));
  const ordered = [...supported].sort((a, b) => rank(a) - rank(b));
  return ordered.filter((level) => rank(level) < ceiling).at(-1) ?? ordered[0] ?? 'off';
}

/**
 * The effort a reasoning level reads as: the chat's default comes from the
 * model's own level (unset runs as 'off', so it reads as Quick).
 */
export function effortOfReasoning(level: ReasoningLevel | undefined): ChatEffort {
  switch (level) {
    case 'medium':
      return 'balanced';
    case 'high':
      return 'deep';
    case 'xhigh':
    case 'max':
      return 'max';
    default:
      return 'quick';
  }
}

/**
 * The effort a model with these levels actually runs for `effort`: itself when
 * the model has it, else the effort its nearest level reads as (Max on a
 * model that stops at high runs as Deep).
 */
export function effectiveEffort(effort: ChatEffort, supported: readonly ReasoningLevel[]): ChatEffort {
  if (effortAvailable(effort, supported)) return effort;
  const fallback = effortOfReasoning(effortReasoning(effort, supported));
  return effortAvailable(fallback, supported) ? fallback : 'quick';
}
