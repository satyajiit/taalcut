// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenAI's Image API with the user's OpenAI API key (`POST https://api.openai.com/v1/images/generations`),
 * GPT Image 2.5 only: gpt-image-1 shuts down 2026-10-23 and 1.5, 1-mini and chatgpt-image-latest on
 * 2026-12-01, so none is routed. Quality is `low` for drafts and `medium` for finals; `xhigh` and `max` are
 * never sent. A ChatGPT sign-in can't generate images (OpenAI lists the tool as unsupported for it).
 */
import { z } from 'zod';
import type { ImageAspect } from '../image-types';
import { promptText, type ImageRouteSpec } from '../image-provider';
import { GPT_IMAGE_TOKEN_USD } from '../prices';

const answerSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
  usage: z
    .object({
      input_tokens: z.int().nonnegative(),
      output_tokens: z.int().nonnegative(),
      input_tokens_details: z.object({ text_tokens: z.int().nonnegative().optional() }).optional(),
    })
    .optional(),
});

/** The Image API's fixed sizes: portrait aspects get the tall one. */
const SIZES: Readonly<Record<ImageAspect, string>> = {
  '9:16': '1024x1536',
  '4:5': '1024x1536',
  '16:9': '1536x1024',
  '1:1': '1024x1024',
};

export const OPENAI_IMAGES: ImageRouteSpec = {
  id: 'openai',
  access: 'api-key',
  models: [
    { model: 'openai/gpt-image-2.5-flare', wire: 'gpt-image-2.5-flare' },
    { model: 'openai/gpt-image-2.5-sunburst', wire: 'gpt-image-2.5-sunburst' },
  ],
  perRequest: 'all',
  allOrNothing: false,
  build: ({ wire, request, count, secret }) => ({
    url: 'https://api.openai.com/v1/images/generations',
    headers: { authorization: `Bearer ${secret}` },
    body: {
      model: wire,
      prompt: promptText(request),
      n: count,
      size: SIZES[request.aspect],
      quality: request.size === 'draft' ? 'low' : 'medium',
      output_format: 'png',
    },
  }),
  parse(json) {
    const answer = answerSchema.safeParse(json);
    if (!answer.success) return undefined;
    const usage = answer.data.usage;
    const textTokens = usage?.input_tokens_details?.text_tokens ?? usage?.input_tokens;
    return {
      images: answer.data.data.map((item) => item.b64_json),
      ...(textTokens !== undefined ? { inputTokens: textTokens } : {}),
      ...(usage ? { outputTokens: usage.output_tokens } : {}),
    };
  },
  costFromUsage(parsed) {
    if (parsed.outputTokens === undefined) return undefined;
    const input = (parsed.inputTokens ?? 0) * GPT_IMAGE_TOKEN_USD.textInput;
    return (input + parsed.outputTokens * GPT_IMAGE_TOKEN_USD.imageOutput) / 1_000_000;
  },
};
