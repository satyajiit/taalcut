// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stock provider is a module (Pexels, Freesound), never a switch arm. Search
 * asks it with the user's key for that one call; the key is not stored here.
 */
import {
  STOCK_KINDS,
  STOCK_LICENCES,
  STOCK_PROVIDERS,
  type AsyncResult,
  type StockKind,
  type StockLicence,
  type StockProviderId,
  type StockSearchInput,
} from '@taalcut/core';
import { z } from 'zod';

/** What one GET returned. Header names are matched case-insensitively by callers. */
export interface StockHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** The same GET with the body still to read: a download goes to disk chunk by chunk, never whole in memory. */
export interface StockHttpStream {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Stopping the iteration early releases the response; a network failure mid-body throws from it. */
  readonly body: AsyncIterable<Uint8Array>;
}

/** Injected HTTP. No implementation in this package calls the network by itself. */
export interface StockHttp {
  /** Search pages and preview images: small bodies, read whole. */
  get(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): AsyncResult<StockHttpResponse>;
  /** A rendition download. */
  stream(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): AsyncResult<StockHttpStream>;
}

/** `null` means the user has no key. The key is not cached past the request. */
export interface StockCredentials {
  get(provider: StockProviderId): AsyncResult<string | null>;
}

export interface ProviderSearchContext {
  readonly http: StockHttp;
  readonly credential: string;
  readonly signal: AbortSignal;
  /** Already clamped by the caller to the provider's maximum. */
  readonly perPage: number;
}

/** One allow-listed hit, before the preview is fetched. Provider text may still be raw. */
export interface ProviderHit {
  readonly provider: StockProviderId;
  readonly providerId: string;
  readonly kind: StockKind;
  readonly title: string;
  readonly authorName: string;
  readonly authorUrl: string | null;
  readonly pageUrl: string;
  readonly licence: StockLicence;
  readonly rawLicence: string;
  readonly seconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly renditionKey: string;
  readonly downloadUrl: string;
  /** Remote preview image, or null when the provider has none (a sound). */
  readonly previewUrl: string | null;
  /** Pexels: skip the hit when the image can't be fetched. Freesound uses a placeholder. */
  readonly previewRequired: boolean;
  readonly attribution: string;
}

/** A provider's links are untrusted: only https reaches the cache, never http, file: or javascript:. */
const httpsUrlSchema = z.url({ protocol: /^https$/ });

export function httpsUrl(value: string | null | undefined): string | null {
  return value != null && httpsUrlSchema.safeParse(value).success ? value : null;
}

/** A finite number above zero, or null (a provider's missing or nonsense duration, size or rate). */
export function positiveOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** ProviderHit as the search cache reads it back: every field checked, nothing cast. */
export const providerHitSchema = z.object({
  provider: z.enum(STOCK_PROVIDERS),
  providerId: z.string().min(1).max(100),
  kind: z.enum(STOCK_KINDS),
  title: z.string().max(300),
  authorName: z.string().max(200),
  authorUrl: httpsUrlSchema.nullable(),
  pageUrl: httpsUrlSchema,
  licence: z.enum(STOCK_LICENCES),
  rawLicence: z.string().max(200),
  seconds: z.number().positive().nullable(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  fps: z.number().positive().nullable(),
  renditionKey: z.string().min(1).max(100),
  downloadUrl: httpsUrlSchema,
  previewUrl: httpsUrlSchema.nullable(),
  previewRequired: z.boolean(),
  attribution: z.string().max(500),
}) satisfies z.ZodType<ProviderHit>;

export interface ProviderSearchResult {
  readonly hits: readonly ProviderHit[];
  readonly headers: Readonly<Record<string, string>>;
}

export interface StockProvider {
  readonly id: StockProviderId;
  readonly kinds: readonly StockKind[];
  search(input: StockSearchInput, ctx: ProviderSearchContext): AsyncResult<ProviderSearchResult>;
}

/** A header value, whatever casing the server used. */
export function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
}

/** Seconds from Retry-After, or 60 when the header is missing or not a delay. */
export function retryAfterSeconds(headers: Readonly<Record<string, string>>): number {
  const raw = headerValue(headers, 'retry-after');
  const seconds = raw == null ? Number.NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return 60;
  return Math.max(1, Math.ceil(seconds));
}
