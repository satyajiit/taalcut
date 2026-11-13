// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a person tops up or changes their plan when a provider's quota is used up (G8): the rateLimit card's
 * and the usage dashboard's "billing" link. Providers' own account pages, by provider id; a provider not
 * listed gets no link rather than a guessed one.
 */
const BILLING_URLS: Readonly<Record<string, string>> = {
  openai: 'https://platform.openai.com/settings/organization/billing',
  anthropic: 'https://console.anthropic.com/settings/billing',
  openrouter: 'https://openrouter.ai/settings/credits',
  xai: 'https://console.x.ai',
  elevenlabs: 'https://elevenlabs.io/app/subscription',
};

export function billingUrlFor(provider: string): string | undefined {
  return BILLING_URLS[provider];
}
