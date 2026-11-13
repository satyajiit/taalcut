// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Display names for provider ids. They are company and product names, kept
 * as written in every language, but they go through the catalogue like any
 * other string so translators can add a script-specific form if needed.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

const PROVIDERS: Readonly<Record<string, MessageDescriptor>> = {
  openai: msg({ message: 'OpenAI', comment: 'Brand name: keep as written.' }),
  'openai-codex': msg({ message: 'ChatGPT', comment: 'Brand name: keep as written.' }),
  'openai-codex-images': msg({ message: 'ChatGPT images', comment: 'ChatGPT is a brand name.' }),
  anthropic: msg({ message: 'Anthropic', comment: 'Brand name: keep as written.' }),
  google: msg({ message: 'Google', comment: 'Brand name: keep as written.' }),
  openrouter: msg({ message: 'OpenRouter', comment: 'Brand name: keep as written.' }),
  xai: msg({ message: 'xAI', comment: 'Brand name: keep as written.' }),
  elevenlabs: msg({ message: 'ElevenLabs', comment: 'Brand name: keep as written.' }),
  'cloudflare-workers-ai': msg({ message: 'Cloudflare Workers AI', comment: 'Brand name: keep as written.' }),
  typesafe: msg({ message: 'TypeSafe', comment: 'Brand name: keep as written.' }),
  'github-copilot': msg({ message: 'GitHub Copilot', comment: 'Brand name: keep as written.' }),
  ollama: msg({ message: 'Ollama', comment: 'Brand name: keep as written.' }),
  'lm-studio': msg({ message: 'LM Studio', comment: 'Brand name: keep as written.' }),
  taalcut: msg({ message: 'Taalcut', comment: 'Brand name: keep as written.' }),
  'on-device': msg`On this Mac`,
  onnx: msg`On this Mac`,
  'sherpa-onnx': msg`On this Mac`,
  'whisper-cpp': msg`On this Mac`,
};

/** Subscription names for the login rows (the plan, not the company). */
export const SUBSCRIPTION_NAMES: Readonly<Record<string, MessageDescriptor>> = {
  anthropic: msg({ message: 'Claude', comment: 'Brand name: keep as written.' }),
  'github-copilot': msg({ message: 'GitHub Copilot', comment: 'Brand name: keep as written.' }),
  xai: msg({ message: 'Grok', comment: 'Brand name: keep as written.' }),
};

/** The provider's name, or null for an id we don't know (show the id itself, marked translate="no"). */
export function providerName(i18n: I18n, provider: string): string | null {
  const known = PROVIDERS[provider];
  return known ? i18n._(known) : null;
}
