// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The router's classifier (PRD R26, models SPEC P3.5): one `classify` over the `router` module's chain.
 * TypeSafe Jev pinned to `jev-1.13.0` first (an alias move can't change a shadow comparison mid-run), then
 * Cloudflare Clef-flash (skipped for a state over 20,000 tokens: its hosted window is 24,576), then the
 * on-device rules router, so Local only and a missing key still route. Jev and Clef are decision models:
 * they never write a reply the user sees. Each attempt is a CloudCall row under module `router`.
 */
import { err, LocalOnly, type TaalcutError } from '@taalcut/core';
import { chainFailure } from '../client/chain-error';
import { canFallBack } from '../client/model-client';
import type { FetchFn } from '../client/http-meter';
import type { CredentialProvider } from '../credentials/credential-provider';
import { NoModelForModule } from '../errors';
import type { ModelChoice, ModuleId } from '../modules';
import type { ModelRuntime } from '../runtime/runtime';
import { piAttempt, rulesAttempt, systemOneAttempt, type AttemptDeps } from './attempts';
import type { Classifier, ClassifyRequest } from './classifier-types';
import { CLEF_FLASH_MAX_STATE_TOKENS } from './router-prices';
import { RULES_ROUTER } from './rules-classifier';
import { CLOUDFLARE_PROVIDER, SYSTEM_ONE_PROVIDERS } from './system-one';

export type {
  Classifier,
  ClassifierAnswer,
  ClassifierQuestion,
  ClassifyRequest,
  ClassifyResult,
} from './classifier-types';

/** Spike 04's order, pinned (research 2026-10-14): Jev leads When2Call; Clef-flash is the fast runner-up. */
export const ROUTER_CLASSIFIER_CHAIN: readonly ModelChoice[] = [
  { provider: 'typesafe', model: 'jev-1.13.0' },
  { provider: CLOUDFLARE_PROVIDER, model: '@cf/cloudflare/clef-flash' },
  { ...RULES_ROUTER },
];

export interface ClassifierDeps {
  readonly runtime: ModelRuntime;
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSinkLike;
  /** A fixed chain (tests, harnesses). Else the selector's `router` chain, else ROUTER_CLASSIFIER_CHAIN. */
  readonly chain?: readonly ModelChoice[];
  /** The active profile's chains (ModelProfiles): Settings → Models decides the router like any module. */
  readonly selector?: { effective(module: ModuleId): { readonly chain: readonly ModelChoice[] } };
  readonly fetch?: FetchFn;
  readonly now?: () => number;
  /** Local only (P2-X2): cloud classifiers are refused before anything is sent (core.local_only). */
  readonly localOnly?: () => boolean;
}

type CloudCallSinkLike = AttemptDeps['callLog'];

export function createClassifier(deps: ClassifierDeps): Classifier {
  const attemptDeps: AttemptDeps = {
    runtime: deps.runtime,
    credentials: deps.credentials,
    callLog: deps.callLog,
    // Read globalThis.fetch per call so test guards installed later still apply.
    fetch: deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: deps.now ?? Date.now,
  };
  const isLocal = (choice: ModelChoice) =>
    isRulesRouter(choice) || deps.runtime.isLocalProvider(choice.provider);

  /** The chain this request may try: its target, else the profile's; Local only keeps what runs on this Mac. */
  const chainFor = (request: ClassifyRequest, localOnly: boolean) => {
    const full = request.target
      ? [request.target]
      : (deps.chain ?? deps.selector?.effective('router').chain ?? ROUTER_CLASSIFIER_CHAIN);
    return full.filter((choice) => (!localOnly || isLocal(choice)) && fits(choice, request));
  };

  return {
    async classify(request) {
      const localOnly = deps.localOnly?.() ?? false;
      const chain = chainFor(request, localOnly);
      if (localOnly && chain.length === 0) return err(LocalOnly({ what: 'model' }));
      const failures: TaalcutError[] = [];
      for (const [index, choice] of chain.entries()) {
        const outcome = await attemptFor(choice)(attemptDeps, request, choice, index);
        if (outcome.ok) return outcome;
        failures.push(outcome.error);
        if (!canFallBack(outcome.error) || request.signal?.aborted) break;
      }
      return err(chainFailure(failures) ?? NoModelForModule({ module: 'router' }));
    },
  };
}

/** How an entry is asked: the rules router in-process, Jev and Clef over their own wire, the rest through pi-ai. */
function attemptFor(choice: ModelChoice): typeof piAttempt {
  if (isRulesRouter(choice)) return rulesAttempt;
  return SYSTEM_ONE_PROVIDERS.includes(choice.provider) ? systemOneAttempt : piAttempt;
}

function isRulesRouter(choice: ModelChoice): boolean {
  return choice.provider === RULES_ROUTER.provider && choice.model === RULES_ROUTER.model;
}

/** Clef-flash's hosted window: a long state skips it rather than failing (estimated at 4 characters a token). */
function fits(choice: ModelChoice, request: ClassifyRequest): boolean {
  if (choice.provider !== CLOUDFLARE_PROVIDER || !choice.model.endsWith('/clef-flash')) return true;
  return JSON.stringify(request.state).length / 4 <= CLEF_FLASH_MAX_STATE_TOKENS;
}
