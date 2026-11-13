// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Codex's dedicated Images client: codex-rs/codex-api/src/endpoint/images.rs
 * and codex-rs/model-provider-info/src/lib.rs in github.com/openai/codex.
 * This subscription route has a separate OAuth connection from SIWC chat.
 */
import { z } from 'zod';
import { CHATGPT_IMAGE_PROVIDER } from '@taalcut/core';
import { CODEX_IMAGES_BASE_URL } from '../../signin/codex-images';
import { promptText, type ImageRouteSpec } from '../image-provider';

const answerSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
});

export const CODEX_IMAGES: ImageRouteSpec = {
  id: CHATGPT_IMAGE_PROVIDER,
  access: 'subscription',
  credentialKinds: ['oauth_access'],
  requiredCredentialHeaders: ['chatgpt-account-id'],
  models: [{ model: 'openai/gpt-image-2', wire: 'gpt-image-2' }],
  perRequest: 'one',
  allOrNothing: false,
  maxResponseBytes: 36 * 1024 * 1024,
  redirect: 'error',
  preserveNativeAspect: true,
  build: ({ wire, request, secret, credential }) => ({
    url: `${CODEX_IMAGES_BASE_URL}/images/generations`,
    headers: {
      authorization: `Bearer ${secret}`,
      'chatgpt-account-id': new Headers(credential.headers).get('chatgpt-account-id') ?? '',
      originator: 'taalcut',
      accept: 'application/json',
    },
    body: {
      model: wire,
      prompt: `${promptText(request)}\n\nCompose for a ${request.aspect} aspect ratio. Keep key content within a centered crop at that ratio.`,
      background: 'opaque',
      // The subscription client exposes automatic rendering; public Image API size/quality controls
      // do not establish backend support here. Returned dimensions are measured, never inferred.
      size: 'auto',
      quality: 'auto',
    },
  }),
  parse(json) {
    const answer = answerSchema.safeParse(json);
    return answer.success ? { images: answer.data.data.map((image) => image.b64_json) } : undefined;
  },
};
