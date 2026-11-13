// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One provider's calls for one request: each goes through models' metered fetch and writes its CloudCall
 * row (success, error status, a fetch that threw, or an answer Taalcut refuses), and the stills come back
 * checked, priced and with their Content Credentials read.
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type CloudCallSink,
  type TaalcutError,
} from '@taalcut/core';
import { createHttpMeter, type FetchFn, type HttpMeter } from '../client/http-meter';
import type { CredentialProvider, ResolvedCredential } from '../credentials/credential-provider';
import { ImageOutputInvalid } from '../errors';
import { readImageAnswer, type CheckedImage } from './image-answer';
import type { ImageC2paReader, ImageRouteSpec, ParsedImages } from './image-route-spec';
import type { GeneratedImage, ImageAccess, ImageRequest } from './image-types';
import { imageFetchFailure, imageHttpFailure, recordImageCall, type ImageCallRow } from './image-wire';
import { imagePrice, roundUsd } from './prices';

export interface ImageRequestContext {
  readonly spec: ImageRouteSpec;
  readonly callLog: CloudCallSink;
  /** A 401 drops the cached key. */
  readonly credentials: Pick<CredentialProvider, 'invalidate'>;
  readonly fetch: FetchFn;
  readonly now: () => number;
  readonly c2pa?: ImageC2paReader;
}

/** One call: the provider's model id, the request, how many images it asks for, and the API key. */
export interface ImageCall {
  readonly wire: string;
  readonly request: ImageRequest;
  readonly count: number;
  readonly secret: string;
  readonly credential: ResolvedCredential;
  readonly credentialProviderId: string;
  readonly access: ImageAccess;
}

/**
 * The request's images over as many calls as the provider needs (one per image when it can't make several).
 * A provider that makes one image per call may have made some before one failed: they are paid for and kept.
 */
export async function generateInCalls(
  ctx: ImageRequestContext,
  call: Omit<ImageCall, 'count'>,
): AsyncResult<GeneratedImage[]> {
  const { request } = call;
  const counts =
    ctx.spec.perRequest === 'all' ? [request.count] : Array.from({ length: request.count }, () => 1);
  const images: GeneratedImage[] = [];
  let failure: TaalcutError | undefined;
  for (const count of counts) {
    // A request never sent writes no row: an aborted fetch doesn't reach the wire.
    if (request.signal?.aborted) {
      failure = CancelledError();
      break;
    }
    const made = await requestImages(ctx, { ...call, count });
    if (!made.ok) {
      failure = made.error;
      break;
    }
    images.push(...made.value);
  }
  if (images.length > 0) return ok(images);
  return err(failure ?? ImageOutputInvalid({ provider: ctx.spec.id, model: call.wire }));
}

/** One call and its CloudCall row. */
export async function requestImages(
  ctx: ImageRequestContext,
  call: ImageCall,
): AsyncResult<GeneratedImage[]> {
  const meter = createHttpMeter(ctx.fetch);
  const row = callRow(ctx, call, meter);
  const sent = await send(ctx, meter, call);
  if (!sent.ok) {
    await row({ costUsd: 0, images: 0, error: sent.error });
    return sent;
  }
  const answer = readImageAnswer(ctx.spec, sent.value, call.request, call.count);
  if (!answer.ok) {
    const error = ImageOutputInvalid(
      { provider: ctx.spec.id, model: call.wire },
      { detail: answer.error.detail },
    );
    // Images the provider made were billed unless it bills all or nothing.
    const billedImages = ctx.spec.allOrNothing ? 0 : answer.error.returned;
    const wasted = roundUsd(listPrice(ctx.spec, call) * billedImages);
    await row({ costUsd: wasted, images: 0, error });
    charged(ctx, call, wasted);
    return err(error);
  }
  const { parsed, images } = answer.value;
  const cost = answerCost(ctx.spec, call, parsed);
  await row({ costUsd: cost, images: call.count, ...tokensOf(parsed) });
  charged(ctx, call, cost);
  return ok(await generated(ctx, call, images, roundUsd(cost / call.count)));
}

/** Tells the request's caller what a call billed (nothing when it billed nothing). */
function charged(ctx: ImageRequestContext, call: ImageCall, usd: number): void {
  if (usd > 0) call.request.onCharge?.({ usd, provider: ctx.spec.id, model: call.wire });
}

type RowFacts = Pick<ImageCallRow, 'costUsd' | 'images'> & Partial<ImageCallRow>;

/** Writes the call's row with what the meter saw; started now. */
function callRow(ctx: ImageRequestContext, call: ImageCall, meter: HttpMeter) {
  const startedAt = ctx.now();
  const { request } = call;
  return (rest: RowFacts): Promise<void> =>
    recordImageCall(ctx.callLog, {
      provider: ctx.spec.id,
      model: call.wire,
      billing: call.access === 'subscription' ? 'subscription' : 'apiKey',
      startedAt,
      latencyMs: ctx.now() - startedAt,
      bytesSent: meter.bytesSent,
      bytesReceived: meter.bytesReceived,
      attempt: request.attempt ?? 1,
      ...(request.trace ? { trace: request.trace } : {}),
      ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
      ...rest,
    });
}

/** Sends the call: the answer's body, or the error a fetch that threw or an error status means. */
async function send(ctx: ImageRequestContext, meter: HttpMeter, call: ImageCall): AsyncResult<string> {
  const { spec } = ctx;
  const named = {
    provider: spec.id,
    model: call.wire,
    access: call.access,
    secrets: [call.secret, ...Object.values(call.credential.headers ?? {})],
  };
  const wire = spec.build(call);
  let status: number;
  let body: string;
  try {
    const response = await meter.fetch(wire.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...wire.headers },
      body: JSON.stringify(wire.body),
      redirect: spec.redirect ?? 'error',
      ...(call.request.signal ? { signal: call.request.signal } : {}),
    });
    status = response.status;
    const read = await readResponse(response, spec.maxResponseBytes ?? 64 * 1024 * 1024, call, spec.id);
    if (!read.ok) return read;
    body = read.value;
  } catch (cause) {
    return err(imageFetchFailure(cause, call.request.signal?.aborted ?? false, named));
  }
  if (status < 400) return ok(body);
  if (status === 401) ctx.credentials.invalidate?.(call.credentialProviderId);
  const retryAfter = meter.retryAfterMs !== undefined ? { retryAfterMs: meter.retryAfterMs } : {};
  return err(imageHttpFailure({ ...named, status, body, ...retryAfter }));
}

/** The price table's figure for one image of the asked size; 0 when the table has none. */
function listPrice(spec: ImageRouteSpec, call: ImageCall): number {
  if (call.access === 'subscription') return 0;
  return imagePrice(spec.id, call.wire)?.usd[call.request.size] ?? 0;
}

/** The provider's own figure, else its token usage priced, else the price table. */
function answerCost(spec: ImageRouteSpec, call: ImageCall, parsed: ParsedImages): number {
  if (call.access === 'subscription') return 0;
  return roundUsd(
    parsed.costUsd ?? spec.costFromUsage?.(parsed, call.wire) ?? listPrice(spec, call) * call.count,
  );
}

function tokensOf(parsed: ParsedImages): Pick<ImageCallRow, 'inputTokens' | 'outputTokens'> {
  return {
    ...(parsed.inputTokens !== undefined ? { inputTokens: parsed.inputTokens } : {}),
    ...(parsed.outputTokens !== undefined ? { outputTokens: parsed.outputTokens } : {}),
  };
}

/** The checked stills with their share of the cost and whether they carry Content Credentials. */
async function generated(
  ctx: ImageRequestContext,
  call: ImageCall,
  checked: readonly CheckedImage[],
  share: number,
): Promise<GeneratedImage[]> {
  const images: GeneratedImage[] = [];
  for (const { bytes, facts } of checked) {
    const c2pa = ctx.c2pa ? await ctx.c2pa(bytes, facts.mediaType, call.request.signal) : 'unknown';
    images.push({
      bytes,
      ...facts,
      provider: ctx.spec.id,
      model: call.wire,
      access: call.access,
      costUsd: share,
      c2pa,
    });
  }
  return images;
}

/** Bound the body while reading it, including when the provider omits Content-Length. */
async function readResponse(
  response: Response,
  limit: number,
  call: ImageCall,
  provider: string,
): AsyncResult<string> {
  const tooLarge = () =>
    err(
      ImageOutputInvalid(
        { provider, model: call.wire },
        { detail: 'The image response exceeded the allowed size.' },
      ),
    );
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    return tooLarge();
  }
  if (!response.body) return ok('');
  if (call.request.signal?.aborted) {
    await response.body.cancel();
    return err(CancelledError());
  }
  const reader = response.body.getReader();
  const signal = call.request.signal;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (!signal?.aborted) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(next.value);
    }
    return signal?.aborted ? err(CancelledError()) : ok(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
