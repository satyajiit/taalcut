// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Requests billed to a ChatGPT plan (P1-F3). OpenAI's Sign in with ChatGPT
 * access must not store conversations server-side and only streams, so every
 * such request goes out with `store: false` and `stream: true`, whatever pi-ai
 * or a later pi-ai version builds. pi-ai drops the fields ChatGPT tokens reject
 * only when the base URL is exactly api.openai.com; we drop them always, so a
 * proxy or test server sees what OpenAI would.
 */
import { CHATGPT_PROVIDER } from '@taalcut/core';
import type { ResolvedCredential } from '../credentials/credential-provider';

const REJECTED_FIELDS = [
  'max_output_tokens',
  'temperature',
  'prompt_cache_retention',
  'prompt_cache_options',
];

export function isChatGPTPlan(provider: string, credential: ResolvedCredential | undefined): boolean {
  return provider === 'openai' && credential?.kind === 'oauth_access';
}

/**
 * The provider that serves a choice. The ChatGPT plan is core's CHATGPT_PROVIDER to the model picker, which
 * lists pi-ai's `openai-codex` models once ChatGPT is signed in (main's `credentials.configured`). Taalcut signs
 * in to ChatGPT on `openai`, and nothing is ever stored under `openai-codex` (that is pi-ai's legacy Codex
 * sign-in, which Taalcut doesn't run), so such a pick runs on `openai`, whose catalogue has the same model ids,
 * and only on the plan: `planOnly` (UX3-AGT; before, every one failed with models.not_configured).
 */
export function servingProvider(provider: string): { readonly provider: string; readonly planOnly: boolean } {
  return provider === CHATGPT_PROVIDER
    ? { provider: 'openai', planOnly: true }
    : { provider, planOnly: false };
}

/** A subscription sign-in (ChatGPT, Claude, Copilot, Grok) pays for the call: it isn't billed per token. */
export function isPlanBilled(credential: ResolvedCredential | undefined): boolean {
  return credential?.kind === 'oauth_access';
}

/** The Responses API payload with the ChatGPT-plan rules applied. Leaves non-objects alone. */
export function enforceChatGPTPlan(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const next: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const field of REJECTED_FIELDS) delete next[field];
  next.store = false;
  next.stream = true;
  return next;
}
