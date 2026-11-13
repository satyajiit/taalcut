// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedder's one model queue (P2-L9, IX-E6). The model runs one call at
 * a time:
 *
 * - search queries (urgent texts) always go next, so a search waits at most
 *   for the call in flight;
 * - everything else is first come, first served, and consecutive frame
 *   requests from any caller (one asset's frame vectors, another's cut
 *   pairs) share calls filled up to the profile's image-token budget, so no
 *   call runs half empty at the end of a request. Padding doesn't change a
 *   frame's vector (measured: cosine 1.0 against one frame per call). A call
 *   holds frames sized for one soft-token budget (index frames and
 *   calibrated ones differ, IX2-E1): the model pads a call to its budget.
 *
 * A failed call fails every request that had frames in it (the error is
 * retryable); a cancelled request fails when it comes up and gives no more
 * frames to shared calls.
 */
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { EmbeddingFailed } from '../errors';
import type { EmbeddingImage, EmbeddingModel } from './model';
import { unitVector, type ImageTokenBudget } from './space';

export interface QueueLimits {
  /** Image soft tokens one call takes at most (always at least one frame). */
  readonly batchTokens: number;
  readonly maxBatchFrames: number;
  readonly textBatch: number;
}

export interface WorkQueueDeps {
  /**
   * Runs one call on the model, loading it if needed (model-slot.ts `use`): the load's error fails the request at
   * the head.
   */
  readonly withModel: (call: (model: EmbeddingModel) => Promise<void>) => Promise<TaalcutError | undefined>;
  readonly limits: () => QueueLimits;
  /** Soft tokens a frame becomes. */
  readonly tokensOf: (image: EmbeddingImage) => number;
  /** The budget a frame was sized for: a call never mixes two. */
  readonly budgetOf: (image: EmbeddingImage) => ImageTokenBudget | undefined;
}

type FrameCost = Pick<WorkQueueDeps, 'tokensOf' | 'budgetOf'>;

/** What a frame call holds so far. */
interface CallFill {
  tokens: number;
  frames: number;
  budget?: ImageTokenBudget | undefined;
}

export interface WorkQueue {
  images(items: readonly EmbeddingImage[], signal?: AbortSignal): AsyncResult<Float32Array[]>;
  texts(items: readonly string[], urgent: boolean, signal?: AbortSignal): AsyncResult<Float32Array[]>;
}

type Settle = (result: { ok: true; value: Float32Array[] } | { ok: false; error: TaalcutError }) => void;

interface Request {
  readonly kind: 'images' | 'texts';
  readonly images: readonly EmbeddingImage[];
  readonly texts: readonly string[];
  readonly out: Float32Array[];
  readonly signal?: AbortSignal;
  /** Next item to send to the model. */
  next: number;
  settle: Settle;
}

interface Part {
  readonly request: Request;
  readonly from: number;
  readonly count: number;
}

const length = (request: Request) =>
  request.kind === 'images' ? request.images.length : request.texts.length;

/** Urgent texts (search queries), then everything else in arrival order. */
interface Lines {
  readonly urgent: Request[];
  readonly fifo: Request[];
}

function remove(lines: Lines, request: Request): void {
  for (const line of [lines.urgent, lines.fifo]) {
    const at = line.indexOf(request);
    if (at >= 0) line.splice(at, 1);
  }
}

function fail(lines: Lines, request: Request, error: TaalcutError): void {
  remove(lines, request);
  request.settle(err(error));
}

/** How many of `request`'s next frames still fit in a call that holds `used`. */
function framesThatFit(request: Request, used: CallFill, limits: QueueLimits, cost: FrameCost): number {
  let count = 0;
  for (let image = request.images[request.next]; image; image = request.images[request.next + count]) {
    if (used.frames >= limits.maxBatchFrames) break;
    const tokens = cost.tokensOf(image);
    const budget = cost.budgetOf(image);
    if (used.frames > 0 && (used.tokens + tokens > limits.batchTokens || budget !== used.budget)) break;
    used.tokens += tokens;
    used.frames++;
    used.budget = budget;
    count++;
  }
  return count;
}

/** Frames from the image requests at the head of the line, in order, up to the token budget. */
function imageCall(fifo: readonly Request[], limits: QueueLimits, cost: FrameCost): Part[] {
  const parts: Part[] = [];
  const used: CallFill = { tokens: 0, frames: 0 };
  for (const request of fifo) {
    if (request.kind !== 'images') break;
    if (request.signal?.aborted) continue;
    const count = framesThatFit(request, used, limits, cost);
    if (count > 0) parts.push({ request, from: request.next, count });
    if (request.next + count < request.images.length) break;
  }
  return parts;
}

/** What the next call takes: frames across the image requests at the head, or the head's next texts. */
function callParts(fifo: readonly Request[], head: Request, limits: QueueLimits, cost: FrameCost): Part[] {
  if (head.kind === 'images') return imageCall(fifo, limits, cost);
  return [
    { request: head, from: head.next, count: Math.min(limits.textBatch, head.texts.length - head.next) },
  ];
}

/** One model call over `parts`: a vector per input, in order, or why not. */
async function callModel(
  model: EmbeddingModel,
  kind: Request['kind'],
  parts: readonly Part[],
): Promise<Float32Array[] | TaalcutError> {
  const images = parts.flatMap((p) => p.request.images.slice(p.from, p.from + p.count));
  const texts = parts.flatMap((p) => p.request.texts.slice(p.from, p.from + p.count));
  try {
    const vectors = kind === 'images' ? await model.embedImages(images) : await model.embedTexts(texts);
    const sent = images.length + texts.length;
    if (vectors.length === sent) return vectors;
    return EmbeddingFailed(undefined, { detail: `${sent} inputs gave ${vectors.length} vectors` });
  } catch (cause) {
    const detail = (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
    return EmbeddingFailed(undefined, { detail });
  }
}

/** Hands each part its vectors; a request with nothing left to send is settled. */
function deliver(lines: Lines, parts: readonly Part[], vectors: readonly Float32Array[]): void {
  let offset = 0;
  for (const p of parts) {
    vectors.slice(offset, offset + p.count).forEach((vector, k) => {
      p.request.out[p.from + k] = unitVector(vector);
    });
    offset += p.count;
    if (p.request.next >= length(p.request)) {
      remove(lines, p.request);
      p.request.settle(ok(p.request.out));
    }
  }
}

export function createWorkQueue(deps: WorkQueueDeps): WorkQueue {
  const lines: Lines = { urgent: [], fifo: [] };
  let draining = false;

  async function run(model: EmbeddingModel, head: Request): Promise<void> {
    const parts = callParts(lines.fifo, head, deps.limits(), deps);
    for (const p of parts) p.request.next = p.from + p.count;
    const vectors = await callModel(model, head.kind, parts);
    if ('code' in vectors) for (const p of parts) fail(lines, p.request, vectors);
    else deliver(lines, parts, vectors);
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let head = lines.urgent[0] ?? lines.fifo[0]; head; head = lines.urgent[0] ?? lines.fifo[0]) {
        if (head.signal?.aborted) {
          fail(lines, head, CancelledError());
          continue;
        }
        const unloaded = await deps.withModel((model) => run(model, head));
        if (unloaded) fail(lines, head, unloaded);
      }
    } finally {
      draining = false;
    }
  }

  function enqueue(
    kind: Request['kind'],
    images: readonly EmbeddingImage[],
    texts: readonly string[],
    isUrgent: boolean,
    signal: AbortSignal | undefined,
  ): AsyncResult<Float32Array[]> {
    if (images.length + texts.length === 0) return Promise.resolve(ok([]));
    return new Promise((resolve) => {
      const request: Request = {
        kind,
        images,
        texts,
        out: [],
        next: 0,
        settle: resolve,
        ...(signal ? { signal } : {}),
      };
      (isUrgent ? lines.urgent : lines.fifo).push(request);
      void drain();
    });
  }

  return {
    images: (items, signal) => enqueue('images', items, [], false, signal),
    texts: (items, isUrgent, signal) => enqueue('texts', [], items, isUrgent, signal),
  };
}
