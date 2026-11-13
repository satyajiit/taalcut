// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Image generation (P3-B7, R28): what a still is asked for and what comes back. A prompt is text the agent
 * wrote, never the user's media, so generating needs no upload consent. Image model ids are OpenRouter's
 * `<vendor>/<model>` names ('x-ai/grok-imagine-image-2.0'), the names the profiles' images chains use; each
 * provider maps them to its own wire id.
 */
import type {
  AsyncResult,
  C2paPresence,
  GenerationAvailability,
  ProjectId,
  TaalcutError,
} from '@taalcut/core';

export const IMAGE_ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
/** draft: about 1K on the long side; final: about 2K where the provider has it. */
export const IMAGE_SIZES = ['draft', 'final'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
export const MAX_IMAGE_PROMPT = 2_000;
export const MAX_IMAGES_PER_REQUEST = 4;

export interface ImageTrace {
  readonly runId?: string;
  readonly spanId?: string;
  readonly projectId?: ProjectId;
}

export interface ImageRequest {
  /** At most 2,000 characters, written by the agent. */
  readonly prompt: string;
  readonly aspect: ImageAspect;
  readonly size: ImageSize;
  readonly count: 1 | 2 | 3 | 4;
  readonly seed?: number;
  /** What the image must not show. No provider has a negative-prompt field, so it joins the prompt as text. */
  readonly avoid?: string;
  readonly signal?: AbortSignal;
  readonly trace?: ImageTrace;
  /** The CloudCall row's attempt: 1 for the first path tried, 2 and up after a fallback. */
  readonly attempt?: number;
  /** The chain pins the checked billing mode so an account change cannot start an unapproved paid call. */
  readonly requiredAccess?: ImageAccess;
  /**
   * Told of every provider call that billed, as soon as its row is written: an answer Taalcut refuses is paid for
   * too, and a caller that fails later still knows what it spent (review H2, M8).
   */
  readonly onCharge?: (charge: ImageCharge) => void;
}

/** One billed provider call: what it cost and who billed it (the provider's own model id). */
export interface ImageCharge {
  readonly usd: number;
  readonly provider: string;
  readonly model: string;
}

/** Whether the call uses a provider key, OpenRouter key, or the signed-in account's plan allowance. */
export type ImageAccess = 'api-key' | 'openrouter' | 'subscription';

/** Availability carries the resolved credential's billing mode, without exposing the credential. */
export type ImageAvailability = GenerationAvailability & {
  readonly access?: ImageAccess;
  readonly error?: TaalcutError;
};

export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly mediaType: ImageMediaType;
  readonly width: number;
  readonly height: number;
  /** The route's provider id ('openrouter', 'xai', 'google', 'openai'). */
  readonly provider: string;
  /** The provider's own model id, as sent. */
  readonly model: string;
  readonly access: ImageAccess;
  /** This image's incremental API spend. Subscription calls record 0; their plan quota is not priced here. */
  readonly costUsd: number;
  /** Read from the bytes when a reader is composed, never added or removed; 'unknown' when not read. */
  readonly c2pa: C2paPresence;
}

/** What a still costs before it is made. `estimated`: token-priced, so shown as "about". */
export interface ImageEstimate {
  readonly usd: number;
  readonly estimated: boolean;
}

export interface ImageProvider {
  /** 'openrouter', 'xai', 'google', 'openai': also the credential's provider id. */
  readonly id: string;
  readonly access: ImageAccess;
  /** The image model ids this provider can make stills with, in its preference order. */
  models(): readonly string[];
  /** The image model id for this provider's own model id (a chain entry that names the provider directly). */
  modelFor(providerModel: string): string | undefined;
  /**
   * Whether this path can run now: Local only, a supported model, and a credential the route accepts.
   * Async because credentials live in the main process.
   */
  available(model: string, signal?: AbortSignal): Promise<ImageAvailability>;
  /** Null when the price isn't known: shown as unknown, never as US$0. */
  estimate(model: string, request: Pick<ImageRequest, 'size' | 'count'>): ImageEstimate | null;
  /** One provider request; one CloudCall row when it reached the wire. */
  generate(model: string, request: ImageRequest): AsyncResult<readonly GeneratedImage[]>;
}

/** A move to the next key or model after a failure the chain may recover from. */
export interface ImageFallback {
  readonly from: { readonly provider: string; readonly model: string };
  readonly to: { readonly provider: string; readonly model: string };
  readonly reason: TaalcutError;
}
