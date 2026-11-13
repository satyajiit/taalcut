// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The subscription sign-ins Taalcut offers, and the warning-card gate (P1-F6).
 * ChatGPT's sign-in is OpenAI's own token sharing for third-party agents, so it
 * needs no warning. Claude, Copilot and Grok sign-ins reuse another app's
 * client and, for Claude and Copilot, make Taalcut's requests look like that
 * app's (SPEC.md, "Subscription sign-ins"). They stay locked until the user has
 * acknowledged the current version of the feature's warning card.
 */
import { CHATGPT_IMAGE_PROVIDER, ok, type AsyncResult } from '@taalcut/core';
import { CHATGPT_SIGN_IN } from './chatgpt';

export interface WarningCard {
  /** Stable id recorded with the acknowledgement. */
  readonly feature: string;
  /** Bump when the card's facts change; older acknowledgements then stop counting. */
  readonly termsVersion: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly riskKey: string;
  readonly acceptKey: string;
}

export interface SignInOption {
  /** pi-ai provider id. */
  readonly provider: string;
  /** 'browser' opens the system browser; 'device_code' shows a code to type on the provider's site. */
  readonly flow: 'browser' | 'device_code';
  /** The button. */
  readonly labelKey: string;
  /** Shown while signed in, e.g. "Using ChatGPT plan". */
  readonly planLabelKey: string;
  /**
   * Where the user checks or manages the plan's limits. Only provider-published URLs, on core's external-link
   * hosts (Settings opens it through `files.openExternal`). Grok's plan has no such page on those hosts.
   */
  readonly manageUsageUrl?: string;
  readonly warning?: WarningCard;
}

const card = (name: string, termsVersion: string): WarningCard => ({
  feature: `signin.${name}`,
  termsVersion,
  titleKey: `models.warning.${name}.title`,
  bodyKey: `models.warning.${name}.body`,
  riskKey: `models.warning.${name}.risk`,
  acceptKey: 'models.warning.accept',
});

export const SIGN_IN_OPTIONS: readonly SignInOption[] = [
  {
    provider: 'openai',
    flow: 'browser',
    labelKey: 'models.signin.chatgpt.continue',
    planLabelKey: 'models.account.chatgpt.usingPlan',
    manageUsageUrl: CHATGPT_SIGN_IN.usageUrl,
  },
  {
    provider: CHATGPT_IMAGE_PROVIDER,
    flow: 'browser',
    labelKey: 'models.signin.chatgptImages.continue',
    planLabelKey: 'models.account.chatgptImages.usingPlan',
    manageUsageUrl: CHATGPT_SIGN_IN.usageUrl,
  },
  {
    provider: 'anthropic',
    flow: 'browser',
    labelKey: 'models.signin.claude.continue',
    planLabelKey: 'models.account.claude.usingPlan',
    // Settings › Usage on claude.ai: the plan's session and weekly limits.
    manageUsageUrl: 'https://claude.ai/settings/usage',
    warning: card('claude', '2026-10-12'),
  },
  {
    provider: 'github-copilot',
    flow: 'device_code',
    labelKey: 'models.signin.copilot.continue',
    planLabelKey: 'models.account.copilot.usingPlan',
    // "Your Copilot": the premium requests used this month (GitHub docs, "Monitor premium requests").
    manageUsageUrl: 'https://github.com/settings/copilot',
    warning: card('copilot', '2026-10-12'),
  },
  {
    provider: 'xai',
    flow: 'device_code',
    labelKey: 'models.signin.grok.continue',
    planLabelKey: 'models.account.grok.usingPlan',
    warning: card('grok', '2026-11-06'),
  },
];

export function signInOption(provider: string): SignInOption | undefined {
  return SIGN_IN_OPTIONS.find((option) => option.provider === provider);
}

/** Where acknowledgements of warning cards are kept. packages/library implements it on the database. */
export interface AcknowledgementStore {
  has(feature: string, termsVersion: string): AsyncResult<boolean>;
  /** `at` is epoch ms. */
  record(feature: string, termsVersion: string, at: number): AsyncResult<void>;
  /** When this terms version was acknowledged (epoch ms), for Settings. Optional: without it Settings shows none. */
  acknowledgedAt?(feature: string, termsVersion: string): AsyncResult<number | undefined>;
}

export interface MemoryAcknowledgementStore extends AcknowledgementStore {
  readonly records: readonly { feature: string; termsVersion: string; at: number }[];
}

export function createMemoryAcknowledgementStore(): MemoryAcknowledgementStore {
  const records: { feature: string; termsVersion: string; at: number }[] = [];
  return {
    records,
    has: async (feature, termsVersion) =>
      ok(records.some((r) => r.feature === feature && r.termsVersion === termsVersion)),
    record: async (feature, termsVersion, at) => ok(void records.push({ feature, termsVersion, at })),
    acknowledgedAt: async (feature, termsVersion) =>
      ok(records.find((r) => r.feature === feature && r.termsVersion === termsVersion)?.at),
  };
}
