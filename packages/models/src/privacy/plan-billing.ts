// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which providers bill a plan the person signed in with rather than per token (UX3-AGT). A ChatGPT plan has no
 * money to estimate, no project budget to count against and nothing "left": the price lookup prices its models at
 * US$0 under the plan's own id (CHATGPT_PROVIDER), so no step asks to spend money on it, and the call log records
 * US$0 for its calls (attempt.ts, isPlanBilled).
 *
 * Synchronous for the price lookup: it answers from what it last learned. Main's `configured` list names the
 * ChatGPT plan (an 'openai' sign-in) before any call; the credential provider knows the kind of every provider it
 * has fetched for (a Claude or SuperGrok sign-in among them) from the first call on.
 */
import { CHATGPT_PROVIDER } from '@taalcut/core';
import type { CachingCredentialProvider } from '../credentials/credential-provider';

export interface PlanBilling {
  /** Calls to `provider` are billed to a plan the person signed in with, not per token. */
  isPlanBilled(provider: string): boolean;
  /** Re-reads which providers are set up; after a sign-in, a sign-out or a new key. */
  refresh(): Promise<void>;
}

export interface PlanBillingDeps {
  /** The providers with a key or sign-in, and CHATGPT_PROVIDER when 'openai' is a ChatGPT sign-in. */
  readonly configured: () => Promise<ReadonlySet<string> | undefined>;
  readonly credentials?: Pick<CachingCredentialProvider, 'kindOf'>;
}

export function createPlanBilling(deps: PlanBillingDeps): PlanBilling {
  let configured: ReadonlySet<string> = new Set();
  return {
    isPlanBilled(provider) {
      if (provider === CHATGPT_PROVIDER) return true;
      const kind = deps.credentials?.kindOf(provider);
      if (kind !== undefined) return kind === 'oauth_access';
      return provider === 'openai' && configured.has(CHATGPT_PROVIDER);
    },
    async refresh() {
      configured = (await deps.configured().catch(() => undefined)) ?? configured;
    },
  };
}
