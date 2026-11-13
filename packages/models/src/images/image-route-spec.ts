// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What one image provider file declares (routes.ts holds one per provider): its models, how it builds a
 * request and reads an answer, and how it bills. The shared request, answer checks and CloudCall row are
 * image-request.ts; the ImageProvider over a spec is image-provider.ts.
 */
import type { C2paPresence } from '@taalcut/core';
import type { ResolvedCredential } from '../credentials/credential-provider';
import type { ImageAccess, ImageMediaType, ImageRequest } from './image-types';

/** The HTTP request a provider file builds for one call. */
export interface ImageWireRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

/** What a provider file reads out of a successful answer. */
export interface ParsedImages {
  readonly images: readonly string[];
  /** The provider's own billed figure for the request, when it states one (OpenRouter's usage.cost). */
  readonly costUsd?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** An image model a route makes: the shared id and the provider's own. */
export interface ImageModelRef {
  readonly model: string;
  readonly wire: string;
}

/** Everything one provider file declares. Adding a provider is one more of these in routes.ts. */
export interface ImageRouteSpec {
  readonly id: string;
  readonly access: ImageAccess;
  /** Accepted credentials. Defaults to API keys; subscription-only endpoints must explicitly allow OAuth. */
  readonly credentialKinds?: readonly ResolvedCredential['kind'][];
  /** Account-bound endpoints require these headers in addition to the bearer token. */
  readonly requiredCredentialHeaders?: readonly string[];
  /** Additional credential provider ids to check (e.g. `'openai-codex'` for OpenAI). */
  readonly credentialAliases?: readonly string[];
  readonly models: readonly ImageModelRef[];
  /** 'all': the request's count in one call (`n`); 'one': one call per image. */
  readonly perRequest: 'all' | 'one';
  /** Bills a request in full or not at all (OpenRouter): an answer Taalcut refuses is a US$0 row. */
  readonly allOrNothing: boolean;
  /** Maximum decoded HTTP response bytes; the shared default also bounds provider error bodies. */
  readonly maxResponseBytes?: number;
  /** Endpoints with automatic dimensions keep valid native output; the composition crops it to the canvas. */
  readonly preserveNativeAspect?: boolean;
  /** Authenticated endpoints can disallow redirects so tokens never follow an unexpected destination. */
  readonly redirect?: RequestInit['redirect'];
  build(input: {
    readonly wire: string;
    readonly request: ImageRequest;
    readonly count: number;
    readonly secret: string;
    readonly credential: ResolvedCredential;
  }): ImageWireRequest;
  /** Undefined when the answer isn't the documented shape. */
  parse(json: unknown): ParsedImages | undefined;
  /** What the request cost from its reported token usage, when the provider bills by tokens. */
  costFromUsage?(parsed: ParsedImages, wire: string): number | undefined;
}

/**
 * Reads whether bytes carry C2PA Content Credentials (a generated still is bytes until the library stores it).
 * Presence only; `imageC2paReader` makes one over core's `ContentCredentials.readBytes`.
 */
export type ImageC2paReader = (
  bytes: Uint8Array,
  mediaType: ImageMediaType,
  signal?: AbortSignal,
) => Promise<C2paPresence>;
