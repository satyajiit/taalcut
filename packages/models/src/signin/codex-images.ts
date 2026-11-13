// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Codex image access uses its own OAuth grant. SIWC's OpenAI token-sharing grant
 * stays under `openai`; neither grant is an alias or a fallback for the other.
 * Pi owns browser login, PKCE and refresh; the broker owns credential storage.
 */
import type { OAuthAuth, Provider } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { CHATGPT_IMAGE_PROVIDER } from '@taalcut/core';

export const CODEX_IMAGES_BASE_URL = 'https://chatgpt.com/backend-api/codex';

/** Auth-only registration: image generation runs through Taalcut's metered image routes. */
export function createCodexImagesAuthProvider(oauth?: OAuthAuth): Provider {
  const codex = openaiCodexProvider();
  const upstream = oauth ?? codex.auth.oauth;
  if (!upstream) throw new Error('The bundled Codex provider must support OAuth.');
  return {
    ...codex,
    id: CHATGPT_IMAGE_PROVIDER,
    name: 'ChatGPT Images',
    baseUrl: CODEX_IMAGES_BASE_URL,
    // The copied stream closures are never selected: this connection lists no chat models.
    getModels: () => [],
    getAllModels: () => [],
    auth: {
      oauth: {
        ...upstream,
        async toAuth(credential) {
          const accountId = credential.accountId;
          if (typeof accountId !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(accountId))
            throw new Error('The ChatGPT image connection is missing its account identity. Sign in again.');
          const auth = await upstream.toAuth(credential);
          if (!auth.apiKey) throw new Error('The ChatGPT image connection has no access token.');
          return { apiKey: auth.apiKey, headers: { 'chatgpt-account-id': accountId } };
        },
      },
    },
  };
}
