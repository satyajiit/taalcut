// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Image routes. The chain prefers configured subscription paths; API-key paths retain their order here.
 * A new provider is one file in providers/ and one entry here.
 */
import type { CloudCallSink } from '@taalcut/core';
import type { FetchFn } from '../client/http-meter';
import type { CredentialProvider } from '../credentials/credential-provider';
import { createImageProvider, type ImageC2paReader, type ImageRouteSpec } from './image-provider';
import type { ImageProvider } from './image-types';
import { GOOGLE_IMAGES } from './providers/google';
import { OPENAI_IMAGES } from './providers/openai';
import { OPENROUTER_IMAGES } from './providers/openrouter';
import { XAI_IMAGES } from './providers/xai';
import { CODEX_IMAGES } from './providers/codex';

export const IMAGE_ROUTES: readonly ImageRouteSpec[] = [
  OPENROUTER_IMAGES,
  XAI_IMAGES,
  GOOGLE_IMAGES,
  OPENAI_IMAGES,
  CODEX_IMAGES,
];

/**
 * Image model ids that are never routed, whatever a profile or override says: shut down or about to be
 * (gpt-image-1 on 2026-10-23; gpt-image-1.5, gpt-image-1-mini and chatgpt-image-latest on 2026-12-01;
 * gemini-2.5-flash-image past 2026-10-02). No route lists them; this is the list tests check against.
 */
export const NEVER_ROUTED_IMAGE_MODELS: readonly string[] = [
  'openai/gpt-image-1',
  'openai/gpt-image-1.5',
  'openai/gpt-image-1-mini',
  'openai/chatgpt-image-latest',
  'google/gemini-2.5-flash-image',
];

export interface ImageProvidersDeps {
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSink;
  /** Local only, read on every call: image models are all in the cloud, so it refuses them all. */
  readonly localOnly: () => boolean;
  /** Reads C2PA from the bytes; without it every still says 'unknown'. */
  readonly contentCredentials?: ImageC2paReader;
  readonly fetch?: FetchFn;
  readonly now?: () => number;
  /** Tests: other routes. Default IMAGE_ROUTES. */
  readonly routes?: readonly ImageRouteSpec[];
}

/** The image providers in route order. */
export function createImageProviders(deps: ImageProvidersDeps): ImageProvider[] {
  return (deps.routes ?? IMAGE_ROUTES).map((spec) =>
    createImageProvider(spec, {
      credentials: deps.credentials,
      callLog: deps.callLog,
      localOnly: deps.localOnly,
      ...(deps.contentCredentials ? { c2pa: deps.contentCredentials } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    }),
  );
}
