// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Google's native image models on the Gemini API's Interactions endpoint (Nano Banana 2.1; Imagen is shut
 * down there), with the user's Gemini API key, over models' own fetch rather than the SDK. One image per
 * call. Every still carries Google's SynthID watermark in its pixels, which is not a C2PA manifest.
 */
import { z } from 'zod';
import { GEMINI_IMAGE_TOKEN_USD } from '../prices';
import { promptText, type ImageRouteSpec } from '../image-provider';

const answerSchema = z.object({
  output_image: z.object({ data: z.string().min(1), mime_type: z.string().optional() }),
  usage: z.object({ total_output_tokens: z.int().nonnegative().optional() }).optional(),
});

export const GOOGLE_IMAGES: ImageRouteSpec = {
  id: 'google',
  access: 'api-key',
  models: [
    { model: 'google/gemini-nano-banana-2.1', wire: 'gemini-nano-banana-2.1' },
    { model: 'google/gemini-3-pro-image', wire: 'gemini-3-pro-image' },
  ],
  perRequest: 'one',
  allOrNothing: false,
  build: ({ wire, request, secret }) => ({
    url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
    headers: { 'x-goog-api-key': secret },
    body: {
      model: wire,
      input: promptText(request),
      response_format: {
        type: 'image',
        mime_type: 'image/png',
        aspect_ratio: request.aspect,
        image_size: request.size === 'draft' ? '1K' : '2K',
      },
    },
  }),
  parse(json) {
    const answer = answerSchema.safeParse(json);
    if (!answer.success) return undefined;
    const outputTokens = answer.data.usage?.total_output_tokens;
    return {
      images: [answer.data.output_image.data],
      ...(outputTokens !== undefined ? { outputTokens } : {}),
    };
  },
  costFromUsage(parsed, wire) {
    const rate = GEMINI_IMAGE_TOKEN_USD[wire];
    return parsed.outputTokens !== undefined && rate !== undefined
      ? (parsed.outputTokens * rate) / 1_000_000
      : undefined;
  },
};
