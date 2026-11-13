// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One ImageProvider from a route spec: everything a provider file doesn't say itself. Local only is refused
 * before anything is sent; each route declares which credentials its endpoint supports. Calls, billing
 * provenance, CloudCall rows and answer checks are handled by image-request.ts.
 */
import { err, LocalOnly, ok, type AsyncResult, type CloudCallSink } from '@taalcut/core';
import type { FetchFn } from '../client/http-meter';
import type { CredentialProvider, ResolvedCredential } from '../credentials/credential-provider';
import { ImageAccessDenied, ModelNotConfigured, UnknownModel } from '../errors';
import { generateInCalls, type ImageRequestContext } from './image-request';
import type { ImageC2paReader, ImageRouteSpec } from './image-route-spec';
import type { ImageAccess, ImageAvailability, ImageProvider, ImageRequest } from './image-types';
import { imageEstimate } from './prices';

export type {
  ImageC2paReader,
  ImageModelRef,
  ImageRouteSpec,
  ImageWireRequest,
  ParsedImages,
} from './image-route-spec';

export interface ImageProviderDeps {
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSink;
  /** Read on every call. */
  readonly localOnly: () => boolean;
  readonly fetch?: FetchFn;
  readonly now?: () => number;
  readonly c2pa?: ImageC2paReader;
}

/** The text sent: the agent's prompt, and what to avoid as a plain sentence (no provider has a field). */
export function promptText(request: Pick<ImageRequest, 'prompt' | 'avoid'>): string {
  return request.avoid ? `${request.prompt}\n\nAvoid: ${request.avoid}` : request.prompt;
}

export function createImageProvider(spec: ImageRouteSpec, deps: ImageProviderDeps): ImageProvider {
  const calls: ImageRequestContext = {
    spec,
    callLog: deps.callLog,
    credentials: deps.credentials,
    // Read globalThis.fetch per call so test guards installed later still apply.
    fetch: deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: deps.now ?? Date.now,
    ...(deps.c2pa ? { c2pa: deps.c2pa } : {}),
  };
  const wireOf = (model: string) => spec.models.find((ref) => ref.model === model)?.wire;

  async function resolveCredential(signal?: AbortSignal): AsyncResult<
    | {
        credential: ResolvedCredential & { secret: string };
        providerId: string;
        access: ImageAccess;
      }
    | undefined
  > {
    const ids = [spec.id, ...(spec.credentialAliases ?? [])];
    for (const id of ids) {
      const credential = await deps.credentials.get(id, signal ? { signal } : {});
      if (!credential.ok) return credential;
      const value = credential.value;
      if (!value?.secret) continue;
      if (!(spec.credentialKinds ?? ['api_key']).includes(value.kind)) continue;
      const headers = new Headers(value.headers);
      if (spec.requiredCredentialHeaders?.some((name) => !headers.get(name)?.trim())) continue;
      return ok({
        credential: { ...value, secret: value.secret },
        providerId: id,
        access: value.kind === 'oauth_access' ? 'subscription' : spec.access,
      });
    }
    return ok(undefined);
  }

  return {
    id: spec.id,
    access: spec.access,
    models: () => spec.models.map((ref) => ref.model),
    modelFor: (providerModel) => spec.models.find((ref) => ref.wire === providerModel)?.model,

    async available(model, signal): Promise<ImageAvailability> {
      if (deps.localOnly()) return { ok: false, reason: 'local_only' };
      if (!wireOf(model)) return { ok: false, reason: 'no_model' };
      const key = await resolveCredential(signal);
      if (!key.ok) return { ok: false, reason: 'not_configured', error: key.error };
      if (!key.value) return { ok: false, reason: 'not_configured' };
      return key.value.access === 'subscription' ? { ok: true, access: 'subscription' } : { ok: true };
    },

    estimate(model, request) {
      const wire = wireOf(model);
      return wire && spec.access !== 'subscription' ? imageEstimate(spec.id, wire, request) : null;
    },

    async generate(model, request) {
      if (deps.localOnly()) return err(LocalOnly({ what: 'model' }));
      const wire = wireOf(model);
      if (!wire) return err(UnknownModel({ provider: spec.id, model }));
      const key = await resolveCredential(request.signal);
      if (!key.ok) return key;
      if (!key.value) return err(ModelNotConfigured({ provider: spec.id, model: wire }));
      if (request.requiredAccess && request.requiredAccess !== key.value.access)
        return err(
          ImageAccessDenied(
            { provider: spec.id, model: wire },
            {
              detail: 'The image credential billing mode changed before the request was sent.',
            },
          ),
        );
      return generateInCalls(calls, {
        wire,
        request,
        secret: key.value.credential.secret,
        credential: key.value.credential,
        credentialProviderId: key.value.providerId,
        access: key.value.access,
      });
    },
  };
}
