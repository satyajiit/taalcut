// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which path makes a still: the images module's chain (the active profile, its override, retirements
 * swapped) gives the models in order, and for each model the configured keys are tried in route order. A
 * failure the chain may recover from (rate limit, outage, a key refused) moves to the next key, then to the
 * chain's next model, each move reported as a fallback. Paths without a key are skipped before anything is
 * sent.
 */
import {
  err,
  LocalOnly,
  ok,
  type AsyncResult,
  type Result,
  type TaalcutError,
  type ToolCostEstimate,
} from '@taalcut/core';
import { canFallBack, type ModelSelector } from '../client/model-client';
import { ImageAccessDenied, ImageNoProvider, ImageOutputInvalid, NoModelForModule } from '../errors';
import type { ModelChoice } from '../modules';
import type {
  GeneratedImage,
  ImageAccess,
  ImageEstimate,
  ImageFallback,
  ImageProvider,
  ImageRequest,
} from './image-types';
import { NEVER_ROUTED_IMAGE_MODELS } from './routes';

/** The chat chain's rules, plus a still another path may make properly (wrong type or size). */
const movesOn = (error: TaalcutError) => canFallBack(error) || ImageOutputInvalid.is(error);

export interface ImageChainDeps {
  /** In route order (createImageProviders). */
  readonly providers: readonly ImageProvider[];
  readonly selector: ModelSelector;
}

/** One way to make a model's stills: a provider and the shared image model id. */
export interface ImageCandidate {
  readonly provider: ImageProvider;
  readonly model: string;
  /** Set after credentials are checked; an OAuth route can also accept paid API keys. */
  readonly access?: ImageAccess;
}

/** The image model id a chain entry names: OpenRouter's own names, or a direct provider's model mapped back. */
function imageModelOf(choice: Pick<ModelChoice, 'provider' | 'model'>, providers: readonly ImageProvider[]) {
  if (choice.provider === 'openrouter') return choice.model;
  return providers.find((p) => p.id === choice.provider)?.modelFor(choice.model);
}

/** Every (provider, model) pair the chain allows, chain order first and route order within a model. */
export function imageCandidates(deps: ImageChainDeps): Result<ImageCandidate[]> {
  const chain = deps.selector.resolve('images');
  if (!chain.ok) return chain;
  const explicit =
    chain.value.choices.length === 1 && chain.value.choices[0]?.provider !== 'openrouter'
      ? chain.value.choices[0]?.provider
      : undefined;
  const models: string[] = [];
  for (const choice of chain.value.choices) {
    const model = imageModelOf(choice, deps.providers);
    if (model && !NEVER_ROUTED_IMAGE_MODELS.includes(model) && !models.includes(model)) models.push(model);
  }
  const candidates = models.flatMap((model) =>
    deps.providers
      .filter((p) => (!explicit || p.id === explicit) && p.models().includes(model))
      .map((provider) => ({ provider, model })),
  );
  return candidates.length > 0 ? ok(candidates) : err(NoModelForModule({ module: 'images' }));
}

/** The candidates that can run now; core.local_only or models.image_no_provider when none can. */
async function runnable(deps: ImageChainDeps, signal?: AbortSignal): AsyncResult<ImageCandidate[]> {
  const all = imageCandidates(deps);
  if (!all.ok) return all;
  const usable: ImageCandidate[] = [];
  let credentialError: TaalcutError | undefined;
  let localOnly = false;
  for (const candidate of all.value) {
    const availability = await candidate.provider.available(candidate.model, signal);
    if (availability.error) credentialError ??= availability.error;
    if (availability.ok)
      usable.push({ ...candidate, access: availability.access ?? candidate.provider.access });
    else if (availability.reason === 'local_only') localOnly = true;
  }
  // A configured plan is the person's existing allowance. Never silently spend a paid key after it fails.
  const subscription = usable.filter((candidate) => candidate.access === 'subscription');
  if (subscription.length > 0) return ok(subscription);
  if (credentialError) return err(credentialError);
  if (usable.length > 0) return ok(usable);
  return err(localOnly ? LocalOnly({ what: 'model' }) : ImageNoProvider());
}

export interface ImageGeneration {
  readonly images: readonly GeneratedImage[];
  /** The image model id that made them. */
  readonly model: string;
  readonly fallbacks: readonly ImageFallback[];
}

/** Makes the stills on the first path that works. */
export async function generateImages(
  deps: ImageChainDeps,
  request: ImageRequest,
  onFallback?: (fallback: ImageFallback) => void,
): AsyncResult<ImageGeneration> {
  const paths = await runnable(deps, request.signal);
  if (!paths.ok) return paths;
  const allowed = request.requiredAccess
    ? paths.value.filter((path) => path.access === request.requiredAccess)
    : paths.value;
  if (allowed.length === 0)
    return err(
      ImageAccessDenied(
        { provider: paths.value[0]?.provider.id ?? 'images' },
        { detail: 'The image billing mode authorized for this invocation is no longer available.' },
      ),
    );
  const fallbacks: ImageFallback[] = [];
  for (const [index, path] of allowed.entries()) {
    const made = await path.provider.generate(path.model, {
      ...request,
      attempt: index + 1,
      ...(path.access ? { requiredAccess: path.access } : {}),
    });
    if (made.ok) return ok({ images: made.value, model: path.model, fallbacks });
    const next = allowed[index + 1];
    if (!next || !movesOn(made.error) || request.signal?.aborted) return made;
    const fallback: ImageFallback = {
      from: { provider: path.provider.id, model: path.model },
      to: { provider: next.provider.id, model: next.model },
      reason: made.error,
    };
    fallbacks.push(fallback);
    onFallback?.(fallback);
  }
  return err(ImageNoProvider());
}

/** The path a still would take now, and what one would cost: what the gap card offers. */
export interface ImagePath {
  readonly provider: string;
  readonly model: string;
  readonly access: ImageAccess;
  /** Null when the price isn't known: show it as unknown, never as US$0. */
  readonly estimateUsd: number | null;
  readonly estimated: boolean;
}

/** The first path that can run now, or undefined (Local only, no key, nothing in the chain). */
export async function imagePathAvailable(
  deps: ImageChainDeps,
  request: Pick<ImageRequest, 'size' | 'count'> = { size: 'final', count: 1 },
  signal?: AbortSignal,
): Promise<ImagePath | undefined> {
  const paths = await runnable(deps, signal);
  const first = paths.ok ? paths.value[0] : undefined;
  if (!first) return undefined;
  const access = first.access ?? first.provider.access;
  const estimate = access === 'subscription' ? null : first.provider.estimate(first.model, request);
  return {
    provider: first.provider.id,
    model: first.model,
    access,
    estimateUsd: estimate?.usd ?? null,
    estimated: estimate?.estimated ?? true,
  };
}

/**
 * A synchronous estimate before any key is checked (the tool's estimateCost, the project cap): the chain's
 * first routable model at the dearest route that makes it, so the budget never under-counts. Null when no
 * route has a price for it.
 */
export function chainEstimate(
  deps: ImageChainDeps,
  request: Pick<ImageRequest, 'size' | 'count'>,
): (ImageEstimate & { readonly model: string }) | null {
  const candidates = imageCandidates(deps);
  if (!candidates.ok) return null;
  const priced = candidates.value.flatMap((candidate) => {
    const estimate = candidate.provider.estimate(candidate.model, request);
    return estimate ? [{ ...estimate, model: candidate.model }] : [];
  });
  const first = priced[0];
  if (!first) return null;
  return priced
    .filter((estimate) => estimate.model === first.model)
    .reduce((a, b) => (b.usd > a.usd ? b : a));
}

/** Resolve billing before the budget gate: plan allowance is not incremental API spend. */
export async function refineImageCost(
  deps: ImageChainDeps,
  request: Pick<ImageRequest, 'size' | 'count'>,
  signal?: AbortSignal,
): AsyncResult<ToolCostEstimate> {
  const paths = await runnable(deps, signal);
  if (!paths.ok) return paths;
  const billed = { unit: 'image', quantity: request.count } as const;
  if (paths.value[0]?.access === 'subscription')
    return ok({
      usd: 0,
      billing: 'subscription',
      billed,
      basis: 'Using subscription allowance; quota is managed by the provider; no incremental API spend',
    });
  const estimate = chainEstimate(deps, request);
  return ok({
    usd: estimate?.usd ?? 0,
    billing: 'apiKey',
    billed,
    basis: estimate
      ? `${request.count} images at the dearest API route for ${estimate.model}`
      : 'No API price is available for the configured image route',
  });
}
