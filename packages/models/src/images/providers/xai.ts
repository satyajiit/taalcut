// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * xAI Imagine accepts API keys and the xAI OAuth api:access grant. x.ai/news/grok-hermes documents
 * subscription image access; Hermes' plugins/image_gen/xai sends the same endpoint a resolved OAuth bearer.
 */
import { z } from 'zod';
import { promptText, type ImageRouteSpec } from '../image-provider';

const answerSchema = z.object({ data: z.array(z.object({ b64_json: z.string().min(1) })).min(1) });

export const XAI_IMAGES: ImageRouteSpec = {
  id: 'xai',
  access: 'api-key',
  credentialKinds: ['api_key', 'oauth_access'],
  redirect: 'error',
  models: [{ model: 'x-ai/grok-imagine-image-2.0', wire: 'grok-imagine-image-2.0' }],
  perRequest: 'all',
  allOrNothing: false,
  build: ({ wire, request, count, secret }) => ({
    url: 'https://api.x.ai/v1/images/generations',
    headers: { authorization: `Bearer ${secret}` },
    body: {
      model: wire,
      prompt: promptText(request),
      n: count,
      aspect_ratio: request.aspect,
      resolution: request.size === 'draft' ? '1k' : '2k',
      response_format: 'b64_json',
    },
  }),
  parse(json) {
    const answer = answerSchema.safeParse(json);
    return answer.success ? { images: answer.data.data.map((item) => item.b64_json) } : undefined;
  },
};
