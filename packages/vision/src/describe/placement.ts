// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the vision module's models run, and what a call may cost. A tool's
 * metadata is fixed when it is registered, so the placement is read from the
 * vision chain then: 'local' only when every model in the chain is on this
 * Mac. A chain with a cloud model anywhere (the built-in profiles put a local
 * model first and cloud fallbacks after it) is 'cloud', because a fallback
 * would upload the frame.
 */
import type { ToolCostEstimate } from '@taalcut/core';
import type { ModelChoice, ModelRuntime, ModelSelector } from '@taalcut/models';
import { estimateImageTokens } from './image-tokens';
import { DETAIL_MAX_DIMENSION, type DescribeFrameInput, type FrameDetail } from './schemas';

export type VisionPlacement = 'local' | 'cloud';

export type VisionRuntime = Pick<ModelRuntime, 'findModel' | 'isLocalProvider'>;

/** The vision chain from the active profile, or none when the module is off or unset. */
export function visionChain(selector: ModelSelector): readonly ModelChoice[] {
  const chain = selector.resolve('vision');
  return chain.ok ? chain.value.choices : [];
}

export function placementOf(chain: readonly ModelChoice[], runtime: VisionRuntime): VisionPlacement {
  return chain.length > 0 && chain.every((c) => runtime.isLocalProvider(c.provider)) ? 'local' : 'cloud';
}

/** System prompt plus the default question, in tokens (about 110, rounded up for safety). */
export const PROMPT_TOKENS = 150;
/** Cap on the answer, reasoning included. A description is 2–4 sentences. */
export const MAX_OUTPUT_TOKENS = 600;

/**
 * Cap on the answer at detail low, the quick look the Analyst takes at every slot (LRN1-CTX): asked with thinking
 * off, so it is the answer alone. Measured on the local 4B at detail low (`_orch/lrn1/logs/ctx/budget/
 * describe-lengths.json`, 32 answers): median 88 tokens, 31 of 32 within 128; the one over was headings, not the
 * plain sentences asked for. A cut answer keeps its whole sentences (`describe-frame.ts`).
 */
export const LOW_DETAIL_ANSWER_TOKENS = 128;

/** The output cap of a call at this detail. */
export function outputTokensFor(detail: FrameDetail): number {
  return detail === 'low' ? LOW_DETAIL_ANSWER_TOKENS : MAX_OUTPUT_TOKENS;
}

/**
 * An upper bound for one call: the frame as a square at the detail level's
 * size, the prompt, and the full output cap, priced with pi-ai's per-model
 * prices. It takes the most expensive cloud model in the chain, since a
 * fallback may run. Local models cost nothing per token.
 */
export function estimateDescribeCost(
  input: Pick<DescribeFrameInput, 'detail' | 'question'>,
  chain: readonly ModelChoice[],
  runtime: VisionRuntime,
): ToolCostEstimate {
  const side = DETAIL_MAX_DIMENSION[input.detail];
  const outputTokens = outputTokensFor(input.detail);
  const promptTokens = PROMPT_TOKENS + Math.ceil((input.question?.length ?? 0) / 4);
  let estimate: ToolCostEstimate = {
    usd: 0,
    tokens: 0,
    basis: chain.length > 0 ? 'on-device vision model: no per-token cost' : 'no vision model configured',
  };
  for (const choice of chain) {
    if (runtime.isLocalProvider(choice.provider)) continue;
    const info = runtime.findModel(choice.provider, choice.model, 'chat');
    if (!info) continue;
    const imageTokens = estimateImageTokens(choice.provider, choice.model, side, side);
    const inputTokens = imageTokens + promptTokens;
    const usd = (inputTokens * info.price.input + outputTokens * info.price.output) / 1_000_000;
    if (usd > estimate.usd || estimate.tokens === 0) {
      estimate = {
        usd,
        tokens: inputTokens + outputTokens,
        basis:
          `upper bound on ${choice.provider}/${choice.model}: ${side}x${side} px frame ≈ ${imageTokens} image ` +
          `+ ${promptTokens} prompt tokens at $${info.price.input}/M, ≤ ${outputTokens} output tokens at $${info.price.output}/M`,
      };
    }
  }
  return estimate;
}
