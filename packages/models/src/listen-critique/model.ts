// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: which hosted model hears the sound, and what that costs at most.
 *
 * The module is `vision`, the chat module for media understanding: every cloud built-in profile already puts a
 * Gemini model in its chain, so the person's own choice of model (Settings → Models) and their consent for the
 * module (its providers) both apply. A separate "listening" module would need core's MODEL_MODULE_IDS, which the
 * CloudCall record and Settings key on (packages/models SPEC, "EAR1 cloud critique").
 *
 * Only Google's Gemini API ('google') can hear: pi-ai 1.4.0 has no audio content block, but its Gemini adapter sends
 * a non-text user part as `inlineData` with the part's MIME type, which is how Gemini's API takes audio. Every other
 * provider would get it as a picture, so the call refuses them before anything is encoded.
 */
import { err, ok, RationalTime, type Result, type ToolCostEstimate } from '@taalcut/core';
import { ModelUnsuitable, NoModelForModule } from '../errors';
import type { ModelChoice, ModuleId } from '../modules';
import type { ModelRuntime } from '../runtime/runtime';
import {
  CLOUD_CRITIQUE_CONTEXT_CHARS,
  CLOUD_CRITIQUE_MAX_OUTPUT_TOKENS,
  CLOUD_CRITIQUE_MAX_SECONDS,
  GEMINI_AUDIO_TOKENS_PER_SECOND,
  type CloudCritiqueInput,
} from './schema';

export const CLOUD_CRITIQUE_MODULE = 'vision' as const satisfies ModuleId;
/** pi-ai providers whose adapter sends a part's MIME type through to a model that hears it. */
export const AUDIO_INPUT_PROVIDERS: readonly string[] = ['google'];
/** The rubric and the clip line, about 1,200 tokens, rounded up. */
const PROMPT_TOKENS = 2_000;
/** The listening summary at its cap, at about four characters a token. */
const TIMELINE_TOKENS = Math.ceil(CLOUD_CRITIQUE_CONTEXT_CHARS / 4);

/** The first model in the chain that can hear, or why none can. */
export function pickCritiqueModel(chain: readonly ModelChoice[]): Result<ModelChoice> {
  const found = chain.find((choice) => AUDIO_INPUT_PROVIDERS.includes(choice.provider));
  if (found) return ok(found);
  const first = chain[0];
  if (!first) return err(NoModelForModule({ module: CLOUD_CRITIQUE_MODULE }));
  return err(
    ModelUnsuitable(
      { provider: first.provider, model: first.model, module: CLOUD_CRITIQUE_MODULE, need: 'audio-input' },
      { detail: 'audio.cloudCritique needs a Gemini model (Google API key) in the vision chain' },
    ),
  );
}

/** The seconds a call may send: its range, else the cap. */
export function critiqueSeconds(input: Pick<CloudCritiqueInput, 'range'>): number {
  const asked = input.range ? RationalTime.toSeconds(input.range.duration) : CLOUD_CRITIQUE_MAX_SECONDS;
  return Math.max(0, Math.min(asked, CLOUD_CRITIQUE_MAX_SECONDS));
}

/** An upper bound from the input alone: the most audio it may send, the whole prompt, and a full answer. */
export function estimateCritiqueCost(
  deps: { readonly chain: () => readonly ModelChoice[]; readonly runtime: Pick<ModelRuntime, 'findModel'> },
  input: CloudCritiqueInput,
): ToolCostEstimate {
  const seconds = critiqueSeconds(input);
  const inputTokens =
    Math.ceil(seconds * GEMINI_AUDIO_TOKENS_PER_SECOND) +
    PROMPT_TOKENS +
    (input.withTimeline ? TIMELINE_TOKENS : 0);
  const outputTokens = CLOUD_CRITIQUE_MAX_OUTPUT_TOKENS;
  const picked = pickCritiqueModel(deps.chain());
  if (!picked.ok) return { usd: 0, tokens: 0, basis: 'no Gemini in the vision chain: nothing would be sent' };
  const { provider, model } = picked.value;
  const price = deps.runtime.findModel(provider, model)?.price;
  const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : 0;
  return {
    usd,
    tokens: inputTokens + outputTokens,
    basis:
      `${provider}/${model}: up to ${Math.round(seconds)} s of audio at ${GEMINI_AUDIO_TOKENS_PER_SECOND} tokens/s, ` +
      `the rubric${input.withTimeline ? ' and the listening summary' : ''}, and an answer of up to ` +
      `${outputTokens} tokens${price ? '' : ' (no catalogue price)'}`,
  };
}
