// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The models Taalcut offers (UX3-AGT). pi-ai's registry is the source of truth: a model it no longer lists is
 * gone. Of what it lists, Taalcut offers each provider's latest generation only, one model per role, for the
 * providers it sets up itself (an API key, Continue with ChatGPT, or a warned sign-in). Every other model of
 * those providers is superseded: the picker leaves it out, a saved choice of it moves to its role's current
 * model (registry/deprecation.ts, once, and Settings says so), and until then a call runs the current model in
 * its place (registry/resolve.ts). Providers not listed here offer what pi-ai lists.
 *
 * Roles, from each provider's own naming: fast (nano, mini, Luna, Haiku, Flash-Lite), everyday (the workhorse:
 * Sol, Sonnet, Flash, Grok), best (Astra, Opus, Pro, Argon) and frontier (Fable). Every id is in pi-ai 1.4.0's
 * catalogue for its provider; current-models.test.ts checks.
 */
import { CHATGPT_PROVIDER } from '@taalcut/core';
import type { ModelChoice } from '../modules';

export type ModelRole = 'fast' | 'everyday' | 'best' | 'frontier';
type Vendor = 'openai' | 'anthropic' | 'google' | 'xai';
type Roles = Readonly<Partial<Record<ModelRole, string>>>;

/** OpenAI's GPT-6 generation, on the API and on the ChatGPT plan alike. */
const GPT: Roles = { fast: 'gpt-6-luna', everyday: 'gpt-6.1-sol', best: 'gpt-6-astra' };

/** Per provider, per model maker (GitHub Copilot serves several), per role: the current model. */
export const CURRENT_MODELS: Readonly<Record<string, Readonly<Partial<Record<Vendor, Roles>>>>> = {
  openai: { openai: GPT },
  [CHATGPT_PROVIDER]: { openai: GPT },
  anthropic: {
    anthropic: {
      fast: 'claude-haiku-5-5',
      everyday: 'claude-sonnet-5-5',
      best: 'claude-opus-5-5',
      frontier: 'claude-fable-5-1',
    },
  },
  google: { google: { fast: 'gemini-3.5-flash-lite', everyday: 'gemini-3.8-flash', best: 'gemini-4-argon' } },
  xai: { xai: { everyday: 'grok-4.7' } },
  'github-copilot': {
    openai: GPT,
    anthropic: {
      fast: 'claude-haiku-5.5',
      everyday: 'claude-sonnet-5.5',
      best: 'claude-opus-5.5',
      frontier: 'claude-fable-5.1',
    },
    google: { everyday: 'gemini-3.8-flash', best: 'gemini-4-argon' },
    xai: { everyday: 'grok-4.7' },
  },
};

/**
 * The day superseded models stop being offered: pi-ai 1.4.0's release (2026-10-21), the registry this list
 * follows. Before it (tests that set an earlier day) they are offered as before.
 */
export const SUPERSEDED_ON = '2026-10-21';

/** The roles of the models the built-in profiles used to pick, where the name alone would mislead. */
const KNOWN_ROLES: Readonly<Record<string, ModelRole>> = {
  'gpt-5.5': 'best', // Best quality's agent until pi-ai 1.4.0
};

/** A model's role, from its name. */
export function roleOf(model: string): ModelRole {
  const known = KNOWN_ROLES[model];
  if (known) return known;
  if (/fable/.test(model)) return 'frontier';
  if (/(^|[-.])(nano|mini|luna|haiku|lite)([-.]|$)/.test(model)) return 'fast';
  if (/(^|[-.])(pro|astra|opus|argon|ultra)([-.]|$)/.test(model)) return 'best';
  return 'everyday';
}

function vendorOf(model: string): Vendor | undefined {
  if (/^(gpt|o\d|chatgpt|codex)/.test(model)) return 'openai';
  if (model.startsWith('claude')) return 'anthropic';
  if (/^(gemini|gemma)/.test(model)) return 'google';
  if (model.startsWith('grok')) return 'xai';
  return undefined;
}

/** Whether Taalcut keeps its own list of `provider`'s current models. */
export function isCurated(provider: string): boolean {
  return CURRENT_MODELS[provider] !== undefined;
}

/** `provider`'s current models, every maker's, every role's. Empty when Taalcut keeps no list for it. */
export function currentModels(provider: string): readonly string[] {
  const makers = Object.values(CURRENT_MODELS[provider] ?? {});
  return [...new Set(makers.flatMap((roles) => Object.values(roles)))];
}

/**
 * What replaces a superseded model: its maker's model for its role at the same provider (the everyday one when
 * that role has none). Undefined for a current model, for providers Taalcut keeps no list for, and for a maker
 * the provider's list doesn't cover.
 */
export function replacementFor(
  choice: Pick<ModelChoice, 'provider' | 'model'>,
): Pick<ModelChoice, 'provider' | 'model'> | undefined {
  const makers = CURRENT_MODELS[choice.provider];
  if (!makers || currentModels(choice.provider).includes(choice.model)) return undefined;
  const vendor = vendorOf(choice.model);
  const all = Object.values(makers);
  // A maker this provider has no list for (Kimi on Copilot, say) keeps its model: nothing of its own replaces it.
  const roles = vendor && makers[vendor] ? makers[vendor] : all.length === 1 ? all[0] : undefined;
  const model = roles?.[roleOf(choice.model)] ?? roles?.everyday ?? roles?.best;
  return model ? { provider: choice.provider, model } : undefined;
}
