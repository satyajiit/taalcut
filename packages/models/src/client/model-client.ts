// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * createModelClient: the one way Taalcut talks to chat models (PRD R26). Each
 * call looks up the module's chain in the active profile at call time, so a
 * profile switch applies to the next call with no restart. When a model is
 * rate-limited, down or not set up before it produced any output, the call
 * moves to the next model in the chain and says so with a 'fallback' event.
 */
import { err, LocalOnly, ok, type CloudCallSink, type Result, type TaalcutError } from '@taalcut/core';
import type { CredentialProvider } from '../credentials/credential-provider';
import { ModelAuthExpired, NoModelForModule, UnknownModel, UnsupportedModule } from '../errors';
import { MODULES, type ModelChoice, type ModuleId } from '../modules';
import { runtimeInternals, type ModelRuntime } from '../runtime/runtime';
import { runAdapterAttempt } from './adapter-attempt';
import { runAttempt, type AttemptDeps, type AttemptOutcome } from './attempt';
import { chainFailure } from './chain-error';
import { CHATGPT_PLAN_DEFAULT } from './chatgpt-plan-models';
import type { FetchFn } from './http-meter';
import { limitOfError, type LimitObserver } from '../limits/usage-limits';
import { createModelStream } from './model-stream';
import type { ModelClient, ModelRequest, ModelResult } from './types';

/** A module's models in the order to try them. */
export interface ResolvedChain {
  readonly module: ModuleId;
  readonly choices: readonly ModelChoice[];
}

/** Picks models for a module. The profiles service implements it. */
export interface ModelSelector {
  resolve(module: ModuleId): Result<ResolvedChain>;
}

export interface ModelClientDeps {
  readonly runtime: ModelRuntime;
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSink;
  /** Needed unless every request names its target. */
  readonly selector?: ModelSelector;
  /** Base fetch for provider HTTP. Record/replay cassettes plug in here. Default: globalThis.fetch. */
  readonly fetch?: FetchFn;
  readonly now?: () => number;
  /** Provider-level retries before the chain moves on. Default: 1 retry, waits capped at 10 s. */
  readonly retry?: {
    readonly maxRetries?: number;
    readonly maxRetryDelayMs?: number;
    readonly timeoutMs?: number;
  };
  /**
   * An in-process client that serves a provider instead of pi-ai: the embedded
   * local runtime when it has no HTTP server (D16; see attachLocalRuntime).
   */
  readonly localAdapter?: (provider: string) => ModelClient | undefined;
  /**
   * Starts the embedded local runtime before a call to it and holds it until
   * the call ends, so it can't idle out mid-answer (attachLocalRuntime's
   * localLease). `model` is the one the call asks for: the runtime serves it
   * when it is installed (MLX1). Resolves with nothing for providers it doesn't
   * manage.
   */
  readonly localLease?: (
    provider: string,
    signal?: AbortSignal,
    model?: string,
  ) => Promise<Result<{ release(): void } | undefined>>;
  /**
   * Local only (P2-X2, G9), read on every call: cloud models are dropped from
   * the chain before anything is sent (no fallback event, no cloud-call row).
   * Nothing left on this Mac, or an explicit cloud target, is core.local_only.
   */
  readonly localOnly?: () => boolean;
  /** G8: every rate, quota or plan limit a call meets, and every success that lifts one (the usage limits). */
  readonly limits?: LimitObserver;
  /** FIX-RUN: a stream with no byte and no event for this long is aborted as dropped. Default 90 s. */
  readonly stallMs?: number;
  /** FIX-CMT: the longest an embedded-runtime call may take, start to end. Default 15 minutes. */
  readonly localDeadlineMs?: number;
}

/** Errors after which the next model in the chain may succeed. */
const FALLBACK_CODES = new Set([
  'models.rate_limited',
  'models.provider_unavailable',
  'models.not_configured',
  'models.quota_exceeded',
  'models.auth_expired',
  'models.auth_invalid',
  'models.sign_in_required',
  'models.secret_store_failed',
  'models.unknown_model',
  'models.model_unsuitable',
  'models.local_runtime_unavailable',
  'models.local_runtime_failed',
]);

export function canFallBack(error: TaalcutError): boolean {
  return FALLBACK_CODES.has(error.code);
}

export function createModelClient(deps: ModelClientDeps): ModelClient {
  const attemptDeps: AttemptDeps = {
    internals: runtimeInternals(deps.runtime),
    isLocal: (provider) => deps.runtime.isLocalProvider(provider),
    credentials: deps.credentials,
    callLog: deps.callLog,
    // Read globalThis.fetch per call so test guards and cassettes installed later still apply.
    fetch: deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: deps.now ?? Date.now,
    retry: { maxRetries: 1, maxRetryDelayMs: 10_000, ...deps.retry },
    ...(deps.stallMs !== undefined ? { stallMs: deps.stallMs } : {}),
    ...(deps.localDeadlineMs !== undefined ? { localDeadlineMs: deps.localDeadlineMs } : {}),
  };

  const chainFor = (request: ModelRequest): Result<readonly ModelChoice[]> => {
    if (!MODULES[request.module].kinds.includes('chat'))
      return err(UnsupportedModule({ module: request.module }));
    if (request.target) return { ok: true, value: [request.target] };
    if (!deps.selector)
      return err(NoModelForModule({ module: request.module }, { detail: 'No selector configured.' }));
    const chain = deps.selector.resolve(request.module);
    if (!chain.ok) return chain;
    if (chain.value.choices.length === 0) return err(NoModelForModule({ module: request.module }));
    return { ok: true, value: chain.value.choices };
  };

  /** Under Local only, the chain's models on this Mac, or core.local_only when there are none. */
  const allowedChain = (request: ModelRequest): Result<readonly ModelChoice[]> => {
    const chain = chainFor(request);
    if (!chain.ok || !deps.localOnly?.()) return chain;
    const local = chain.value.filter((choice) => deps.runtime.isLocalProvider(choice.provider));
    return local.length > 0 ? ok(local) : err(LocalOnly({ what: 'model' }));
  };

  const stream: ModelClient['stream'] = (request) =>
    createModelStream(async (emit) => {
      const chain = allowedChain(request);
      if (!chain.ok) {
        emit({ type: 'error', error: chain.error });
        return chain;
      }
      const failures: TaalcutError[] = [];
      let attempt = 0;
      for (const [index, choice] of chain.value.entries()) {
        const lease = deps.localLease
          ? await deps.localLease(choice.provider, request.signal, choice.model)
          : ok(undefined);
        let outcome: AttemptOutcome;
        if (!lease.ok) {
          outcome = { result: lease, producedOutput: false };
        } else {
          // Looked up after the lease: a runtime it just started has only now registered its endpoint.
          const adapter = deps.localAdapter?.(choice.provider);
          const run = (picked: ModelChoice = choice) =>
            adapter
              ? runAdapterAttempt(adapter, request, picked, emit)
              : runAttempt(attemptDeps, request, picked, ++attempt, emit);
          try {
            outcome = await run();
            // A sign-in token the provider no longer takes: the 401 invalidated it, so one more try
            // runs on a refreshed token before the chain moves on.
            if (
              !outcome.result.ok &&
              outcome.result.error.code === ModelAuthExpired.code &&
              !outcome.producedOutput &&
              !request.signal?.aborted
            ) {
              outcome = await run();
            }
            // ChatGPT turned down the plan model its role maps to: once more on the plan's default (UX3-AGT).
            const turnedDown = outcome.planModel;
            if (
              turnedDown !== undefined &&
              turnedDown !== CHATGPT_PLAN_DEFAULT &&
              !outcome.result.ok &&
              outcome.result.error.code === UnknownModel.code &&
              !outcome.producedOutput &&
              !request.signal?.aborted
            ) {
              const from = { ...choice, model: turnedDown };
              const to = { ...choice, model: CHATGPT_PLAN_DEFAULT };
              console.warn(
                `models: ChatGPT didn't accept ${turnedDown} for ${request.module}; trying the plan's default, ${CHATGPT_PLAN_DEFAULT}`,
              );
              emit({ type: 'fallback', from, to, reason: outcome.result.error });
              outcome = await run(to);
            }
          } finally {
            lease.value?.release();
          }
        }
        noteLimits(deps, request.module, choice, outcome.result);
        if (outcome.result.ok) {
          emit({ type: 'done', result: outcome.result.value });
          return outcome.result;
        }
        const failure = outcome.result.error;
        failures.push(failure);
        const next = chain.value[index + 1];
        if (!next || outcome.producedOutput || !canFallBack(failure) || request.signal?.aborted) break;
        emit({ type: 'fallback', from: choice, to: next, reason: failure });
      }
      // A model that was set up explains the failure better than the unconfigured ones after it (UX3-AGT).
      const error = chainFailure(failures) ?? NoModelForModule({ module: request.module });
      emit({ type: 'error', error });
      return err(error);
    });

  return {
    stream,
    complete: (request): Promise<Result<ModelResult>> => stream(request).result(),
  };
}

/** Tells the usage limits what a call met: a limit noted, or one lifted by a success. */
function noteLimits(
  deps: Pick<ModelClientDeps, 'limits' | 'now'>,
  module: ModuleId,
  choice: ModelChoice,
  result: Result<ModelResult>,
): void {
  if (!deps.limits) return;
  if (result.ok) return deps.limits.cleared(choice.provider, choice.model);
  const limit = limitOfError(result.error, module, choice, (deps.now ?? Date.now)());
  if (limit) deps.limits.met(limit);
}
