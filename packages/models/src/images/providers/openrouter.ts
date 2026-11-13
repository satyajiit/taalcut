// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenRouter's image API (`POST https://openrouter.ai/api/v1/images`, the documented path as of 2026-10-14;
 * pi-ai 1.2.0's chat-completions bridge records US$0 for Grok stills, so it isn't used). One key reaches
 * every vendor's image model; the answer's `usage.cost` is what was billed, all or nothing.
 */
import { z } from 'zod';
import { promptText, type ImageRouteSpec } from '../image-provider';

const answerSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1), media_type: z.string().optional() })).min(1),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

const MODELS = [
  'x-ai/grok-imagine-image-2.0',
  'google/gemini-nano-banana-2.1',
  'openai/gpt-image-2.5-flare',
  'openai/gpt-image-2.5-sunburst',
  'google/gemini-3-pro-image',
  'openai/gpt-image-2',
];

export const OPENROUTER_IMAGES: ImageRouteSpec = {
  id: 'openrouter',
  access: 'openrouter',
  models: MODELS.map((model) => ({ model, wire: model })),
  perRequest: 'all',
  allOrNothing: true,
  build: ({ wire, request, count, secret }) => ({
    url: 'https://openrouter.ai/api/v1/images',
    headers: { authorization: `Bearer ${secret}` },
    body: {
      model: wire,
      prompt: promptText(request),
      n: count,
      aspect_ratio: request.aspect,
      resolution: request.size === 'draft' ? '1k' : '2k',
      // The endpoint tiers its price by quality and resolution: low_1k for drafts, medium_2k for finals.
      quality: request.size === 'draft' ? 'low' : 'medium',
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    },
  }),
  parse(json) {
    const answer = answerSchema.safeParse(json);
    if (!answer.success) return undefined;
    const cost = answer.data.usage?.cost;
    return {
      images: answer.data.data.map((item) => item.b64_json),
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };
  },
};
