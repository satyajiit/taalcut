// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Connects a running embedded runtime to ModelClient. An OpenAI-compatible
 * runtime becomes the 'on-device' LocalEndpoint of each ModelRuntime, so pi-ai
 * calls it like any local server; an adapter runtime is handed to ModelClient
 * through `localAdapter`. When the runtime stops, its endpoint goes away and
 * calls for its models fail over with models.local_runtime_unavailable, unless
 * a LocalRuntimeManager is attached: then `localLease` starts it first.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { ModelClient } from '../client/types';
import type { LocalEndpoint } from '../runtime/endpoints';
import type { ModelRuntime } from '../runtime/runtime';
import type { LocalRuntimeLease, LocalRuntimeManager } from './manager';
import { LOCAL_RUNTIME_PROVIDER, type LocalRuntime, type LocalRuntimeSpec } from './types';

/** The LocalEndpoint for a runtime serving `baseUrl`, listing only the models it serves. */
export function localRuntimeEndpoint(
  spec: LocalRuntimeSpec,
  baseUrl: string,
  servedModels: readonly string[],
  apiKey?: string,
): LocalEndpoint {
  return {
    id: LOCAL_RUNTIME_PROVIDER,
    name: 'On-device',
    baseUrl,
    // The runtime serves only on this machine, whatever the URL says.
    local: true,
    ...(apiKey ? { apiKey } : {}),
    compute: [...new Set(spec.models.flatMap((m) => m.compute))],
    models: spec.models
      .filter((m) => servedModels.includes(m.id))
      .map((m) => ({
        id: m.id,
        ...(m.name ? { name: m.name } : {}),
        reasoning: m.reasoning,
        vision: m.vision,
        contextWindow: m.contextWindow,
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
        ...(m.thinkingKwarg ? { thinkingKwarg: m.thinkingKwarg } : {}),
      })),
  };
}

export interface AttachedLocalRuntime {
  /** Pass as ModelClientDeps.localAdapter. */
  localAdapter(provider: string): ModelClient | undefined;
  /**
   * Pass as ModelClientDeps.localLease. With a LocalRuntimeManager it starts
   * the runtime before an on-device call (serving `model` when that one is
   * installed: LocalRuntimeManager.acquire) and holds it until the call ends;
   * otherwise it resolves with nothing to hold.
   */
  localLease(
    provider: string,
    signal?: AbortSignal,
    model?: string,
  ): AsyncResult<LocalRuntimeLease | undefined>;
  detach(): void;
}

/** In-process wiring (tests, or a runtime hosted in the agent's own process). */
export function attachLocalRuntime(
  localRuntime: LocalRuntime | LocalRuntimeManager,
  runtimes: readonly ModelRuntime[],
): AttachedLocalRuntime {
  const sync = () => {
    const endpoint = localRuntime.status().state === 'running' ? localRuntime.endpoint() : undefined;
    for (const runtime of runtimes) {
      if (endpoint?.kind === 'openai-compatible') {
        const served = endpoint.models ?? localRuntime.status().installedModels;
        const added = runtime.setEndpoint(
          localRuntimeEndpoint(localRuntime.spec, endpoint.baseUrl, served, endpoint.apiKey),
        );
        if (!added.ok) runtime.removeEndpoint(LOCAL_RUNTIME_PROVIDER);
      } else {
        runtime.removeEndpoint(LOCAL_RUNTIME_PROVIDER);
      }
    }
  };
  sync();
  const unsubscribe = localRuntime.onStatus(sync);
  return {
    localAdapter(provider) {
      if (provider !== LOCAL_RUNTIME_PROVIDER || localRuntime.status().state !== 'running') return undefined;
      const endpoint = localRuntime.endpoint();
      return endpoint?.kind === 'adapter' ? endpoint.client : undefined;
    },
    async localLease(provider, signal, model) {
      if (provider !== LOCAL_RUNTIME_PROVIDER || !('acquire' in localRuntime)) return ok(undefined);
      return localRuntime.acquire({ ...(signal ? { signal } : {}), ...(model ? { model } : {}) });
    },
    detach() {
      unsubscribe();
      for (const runtime of runtimes) runtime.removeEndpoint(LOCAL_RUNTIME_PROVIDER);
    },
  };
}
