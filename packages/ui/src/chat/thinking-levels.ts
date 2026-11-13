// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Thinking levels by their providers' own names (UX3-AGT), for the composer and Settings › Models. A model
 * offers exactly its provider's levels (models' client/thinking.ts), and each shows under the name the provider
 * gives it: OpenAI's reasoning effort none, minimal, low, medium, high, xhigh and max (ChatGPT and Codex show
 * xhigh as Extra high), Anthropic's effort low to max, Google's thinking level minimal to high. OpenAI calls
 * thinking off None; the others have no level for it, so it is Off.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ReasoningLevel } from '@taalcut/core';

/** Core's REASONING_LEVELS, lightest first. The kit may import only types from core: checked below. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type SameLevels = [ReasoningLevel] extends [(typeof THINKING_LEVELS)[number]]
  ? [(typeof THINKING_LEVELS)[number]] extends [ReasoningLevel]
    ? true
    : never
  : never;
const sameLevels: SameLevels = true;
void sameLevels;

const NAMES: Readonly<Record<ReasoningLevel, MessageDescriptor>> = {
  off: msg({ message: 'Off', context: 'thinking level' }),
  minimal: msg({ message: 'Minimal', context: 'thinking level' }),
  low: msg({ message: 'Low', context: 'thinking level' }),
  medium: msg({ message: 'Medium', context: 'thinking level' }),
  high: msg({ message: 'High', context: 'thinking level' }),
  xhigh: msg({ message: 'Extra high', context: 'thinking level' }),
  max: msg({ message: 'Max', context: 'thinking level' }),
};
const NONE = msg({ message: 'None', context: 'thinking level' });

const DESCRIPTIONS: Readonly<Record<ReasoningLevel, MessageDescriptor>> = {
  off: msg`Answers straight away, without thinking first.`,
  minimal: msg`Thinks only briefly. The quickest answer that still thinks.`,
  low: msg`Thinks a little first. Quick, for questions and small edits.`,
  medium: msg`Balances speed and depth. Right for most videos.`,
  high: msg`Thinks longer for harder edits. Slower, and it costs more.`,
  xhigh: msg`Thinks longer still, for the hardest edits. Slower again, and it costs more.`,
  max: msg`Thinks as long as the model can. The slowest and the most expensive.`,
};

/** OpenAI's providers: an API key, the ChatGPT plan, Azure. */
const OPENAI_PROVIDERS = new Set(['openai', 'openai-codex', 'azure']);

/** The model a level belongs to; OpenAI's models keep OpenAI's names wherever they run (Copilot too). */
export interface ThinkingModel {
  readonly provider: string;
  readonly model?: string;
}

/** A level's name as its provider calls it: OpenAI's off is None. */
export function thinkingLevelName(level: ReasoningLevel, of?: ThinkingModel): MessageDescriptor {
  const openai = of !== undefined && (OPENAI_PROVIDERS.has(of.provider) || /^(gpt|o\d)/.test(of.model ?? ''));
  return level === 'off' && openai ? NONE : NAMES[level];
}

/** What a level does, in a line. */
export function thinkingLevelDescription(level: ReasoningLevel): MessageDescriptor {
  return DESCRIPTIONS[level];
}

/**
 * The level a model with `levels` runs `level` at, as pi-ai's clampThinkingLevel picks it: the level itself, else
 * the next one up it has, else the next one down; its lightest (or off) when nothing matches.
 */
export function nearestThinkingLevel(
  level: ReasoningLevel,
  levels: readonly ReasoningLevel[],
): ReasoningLevel {
  if (levels.includes(level)) return level;
  const at = THINKING_LEVELS.indexOf(level);
  const up = THINKING_LEVELS.slice(at + 1).find((l) => levels.includes(l));
  const down = THINKING_LEVELS.slice(0, at)
    .reverse()
    .find((l) => levels.includes(l));
  return up ?? down ?? levels[0] ?? 'off';
}
