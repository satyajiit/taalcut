// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The reasoning levels a chat model takes, which is what the chat's effort
 * (Quick, Balanced, Deep, Max; core's chat/effort.ts) is mapped onto for each
 * call. pi-ai knows them per provider and model (thinkingLevelMap); on-device
 * models answer without thinking, because the embedded runtime's 8,192-token
 * context can't hold the thinking (spike 08) and its chat-template switch has
 * no depth anyway.
 */
import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai';
import { effortReasoning, type ChatEffort } from '@taalcut/core';
import { LOCAL_RUNTIME_PROVIDER } from '../local-runtime/types';
import type { ReasoningLevel } from '../modules';

/** What on-device models take: thinking off. */
export const ON_DEVICE_THINKING: readonly ReasoningLevel[] = ['off'];

/**
 * The reasoning levels a chat model takes, lightest first: exactly the provider's own (UX3-AGT). pi-ai also
 * accepts some levels under a second name, sending another level's value (ChatGPT's and Copilot's minimal go
 * out as low); the provider has one level there, so it is listed once, under its own name.
 */
export function thinkingLevels(
  model: Pick<Model<Api>, 'provider' | 'reasoning' | 'thinkingLevelMap'>,
): ReasoningLevel[] {
  if (model.provider === LOCAL_RUNTIME_PROVIDER) return [...ON_DEVICE_THINKING];
  const levels = getSupportedThinkingLevels(model as Model<Api>) as ReasoningLevel[];
  const sentAs = (level: ReasoningLevel) => model.thinkingLevelMap?.[level];
  return levels.filter((level) => {
    const sent = sentAs(level)?.toLowerCase();
    return sent === undefined || sent === level || !(levels as string[]).includes(sent);
  });
}

/** The level to send this model for a chat effort. */
export function reasoningForEffort(
  model: Pick<Model<Api>, 'provider' | 'reasoning' | 'thinkingLevelMap'>,
  effort: ChatEffort,
): ReasoningLevel {
  return effortReasoning(effort, thinkingLevels(model));
}
