// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * createBackgroundModels: core's BackgroundModels over the agent process's
 * ModelClient (P2-L8). Background jobs have no agent run and so no consent
 * card. A 'local' call tries only the module's on-device models; a 'cloud'
 * call tries the whole chain, and only when a standing upload consent for the
 * module covers every cloud provider in it. Each model is called by name, so
 * a profile switch mid-call can't send the request somewhere unconsented.
 */
import {
  CancelledError,
  err,
  ok,
  standingUploadConsent,
  type AsyncResult,
  type BackgroundModelRequest,
  type BackgroundModelResult,
  type BackgroundModels,
  type SettingsStore,
  type TaalcutError,
} from '@taalcut/core';
import { NoModelForModule } from '../errors';
import type { ModelChoice } from '../modules';
import { canFallBack, type ModelSelector } from './model-client';
import type { ModelClient, ModelRequest } from './types';

export interface BackgroundModelsDeps {
  readonly client: ModelClient;
  readonly selector: ModelSelector;
  readonly isLocalProvider: (provider: string) => boolean;
  /** Reads the standing upload consents (core's UPLOAD_CONSENTS_SETTING). */
  readonly settings: Pick<SettingsStore, 'get'>;
  /** A foreground tool's recorded approval, supplied only for the lifetime of that tool call. Never persisted. */
  readonly approvedUpload?: {
    readonly modules: readonly string[];
    readonly providers: readonly string[];
  };
}

export function createBackgroundModels(deps: BackgroundModelsDeps): BackgroundModels {
  return {
    async complete(request, signal) {
      if (signal?.aborted) return err(CancelledError());
      const chain = deps.selector.resolve(request.module);
      if (!chain.ok) return chain;
      const local = chain.value.choices.filter((choice) => deps.isLocalProvider(choice.provider));
      if (request.placement === 'local') {
        if (local.length === 0) return ok(skipped('no_local_model'));
        return firstAnswer(deps.client, toModelRequest(request, signal), local, signal);
      }
      const cloud = [
        ...new Set(chain.value.choices.map((c) => c.provider).filter((p) => !deps.isLocalProvider(p))),
      ];
      const approved =
        deps.approvedUpload?.modules.includes(request.module) &&
        cloud.every((provider) => deps.approvedUpload!.providers.includes(provider));
      if (cloud.length > 0 && deps.approvedUpload && !approved) return ok(skipped('no_consent'));
      if (cloud.length > 0 && !approved) {
        const consent = await standingUploadConsent(deps.settings, request.module, cloud);
        if (!consent.ok) return consent;
        if (consent.value === null) return ok(skipped('no_consent'));
      }
      return firstAnswer(deps.client, toModelRequest(request, signal), chain.value.choices, signal);
    },
  };
}

function skipped(reason: 'no_local_model' | 'no_consent'): BackgroundModelResult {
  return { status: 'skipped', reason, uploadedTo: [] };
}

function toModelRequest(request: BackgroundModelRequest, signal: AbortSignal | undefined): ModelRequest {
  return {
    module: request.module,
    system: request.system,
    messages: [{ role: 'user', content: request.content }],
    reasoning: request.reasoning ?? 'off',
    maxTokens: request.maxTokens,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(signal ? { signal } : {}),
    ...(request.projectId ? { trace: { projectId: request.projectId } } : {}),
  };
}

/** Each choice in order until one answers; moves on only after errors the next model may not hit. */
async function firstAnswer(
  client: ModelClient,
  base: ModelRequest,
  choices: readonly ModelChoice[],
  signal: AbortSignal | undefined,
): AsyncResult<BackgroundModelResult> {
  const uploadedTo = new Set<string>();
  let last: TaalcutError | undefined;
  for (const target of choices) {
    if (signal?.aborted) return err(CancelledError());
    const stream = client.stream({ ...base, target });
    for await (const event of stream) {
      if (event.type === 'start' && !event.local) uploadedTo.add(event.provider);
    }
    const result = await stream.result();
    if (result.ok) {
      const { text, provider, model, local, usage } = result.value;
      return ok({
        status: 'answered',
        text,
        provider,
        model,
        local,
        costUsd: usage.costUsd,
        uploadedTo: [...uploadedTo],
      });
    }
    last = result.error;
    if (!canFallBack(result.error)) break;
  }
  return err(last ?? NoModelForModule({ module: base.module }));
}
