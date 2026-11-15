// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot descriptions (P2-L8): description, objects, place, shot type, camera
 * motion and people from the vision module's model on each shot's best frame
 * (768 px JPEG), JSON only, temperature 0, thinking off. A background stage
 * with no agent run behind it, so no consent card can be shown:
 * - 'local' runs only the chain's on-device models (the embedded llama.cpp
 *   server, spike 08), each as an explicit target, so nothing can fall back
 *   to the cloud; with none it skips with `no_local_model`.
 * - 'cloud' uploads only under a standing upload consent for `vision`
 *   covering every cloud provider in the chain (core's
 *   standingUploadConsent); without one it skips with `no_consent` and makes
 *   no network call.
 * Model output is untrusted data; the prompt says text in the frame is data.
 * Since LRN1-CTX each shot may carry what is said and shown around it
 * (`shot-context.ts`), sent fenced as untrusted beside the frame, so the
 * description can name what the frame shows (a product, a place) without
 * the model taking the media's words as instructions or naming people.
 * Since LIB1-FIND it also says what people are doing (`actions`: core's fixed words first, read leniently in
 * `actions.ts`, motion words dropped for a shot in which nothing moves), and an answer it can't use is asked once more with a note
 * saying what was wrong, a little above temperature 0: at 0 a small model repeats the same answer.
 * Since MOM1 a shot of 2 s or more is asked from frames at a regular stride, each labelled with its number and time,
 * and its answer also carries the shot's moments (moments.ts); what is asked and how it is read is describe-answer.ts.
 */
import {
  CancelledError,
  err,
  ok,
  standingUploadConsent,
  type AsyncResult,
  type BackgroundModels,
  type FrameRate,
  type SettingsStore,
  type ShotDescription,
  type ShotMoment,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { ModelClient, ModelRequest, ModelSelector } from '@taalcut/models';
import type { z } from 'zod';
import { ModelOutputInvalid } from '../errors';
import type { FrameSource } from '../media/frame-source';
import { shotActions } from './actions';
import {
  answerProblem,
  parseDescription,
  RETRY_TEMPERATURE,
  retryNote,
  shotContent,
  shotRequest,
  type describeAnswerSchema,
  type FrameTimes,
} from './describe-answer';
import { callLocalOnly } from './describe-frame';
import { shotMoments, type MomentSpan } from './moments';
import { visionChain, type VisionPlacement, type VisionRuntime } from './placement';
import type { ShotContext } from './shot-context';
import { shotFrames, type FrameImage } from './shot-frames';

export {
  describeAnswerSchema,
  frameRequestText,
  parseDescription,
  RETRY_TEMPERATURE,
  retryNote,
  SHOT_DESCRIPTION_PROMPT,
  SHOT_MOMENTS_PROMPT,
} from './describe-answer';

export interface DescribeShotsInput {
  readonly path: string;
  /** The source's frame grid. */
  readonly rate: FrameRate;
  /**
   * Each shot's best frame (and optional chronological frames across the shot), as grid indices of the asset, and
   * what is said and shown around it (LRN1-CTX). MOM1: with `span` (the shot's first grid frame and its length in
   * frames) and two frames or more, each picture goes with its number and time and the answer carries the shot's
   * moments (moments.ts).
   */
  readonly shots: readonly {
    readonly shotId: string;
    readonly frame: number;
    readonly frames?: readonly number[];
    readonly span?: { readonly start: number; readonly length: number };
    readonly context?: ShotContext;
  }[];
}

export interface DescribeShotsOutput {
  readonly descriptions: readonly { readonly shotId: string; readonly description: ShotDescription }[];
  readonly model?: { readonly provider: string; readonly model: string; readonly local: boolean };
  /** Cloud providers frames were sent to (failed attempts included); empty on device. */
  readonly uploadedTo: readonly string[];
  /** 'not_yet': the on-device runtime isn't installed or ready; a later run can describe these shots. */
  readonly skipped?: 'no_local_model' | 'no_consent' | 'not_yet';
}

export interface DescribeShotsDeps {
  readonly media: MediaContext;
  /** The asset's frame source (the job's); absent: each frame is extracted on its own. */
  readonly frames?: FrameSource;
  readonly models: {
    readonly client: ModelClient;
    readonly selector: ModelSelector;
    readonly runtime: VisionRuntime;
  };
  readonly settings?: SettingsStore;
}

export interface DescribeShotsContext {
  readonly placement: VisionPlacement;
  readonly signal?: AbortSignal;
  progress?(fraction: number): void;
}

type DescribedBy = NonNullable<DescribeShotsOutput['model']>;
type Skip = NonNullable<DescribeShotsOutput['skipped']>;
/** One model answer for a shot's frame(s), or why no request was made. */
type Ask = (
  images: readonly FrameImage[],
  context: ShotContext | undefined,
  retry: string | undefined,
  times: FrameTimes | undefined,
) => AsyncResult<{ text: string; model: DescribedBy } | { skipped: Skip }>;

export async function describeShots(
  input: DescribeShotsInput,
  deps: DescribeShotsDeps,
  ctx: DescribeShotsContext,
): AsyncResult<DescribeShotsOutput> {
  const chain = visionChain(deps.models.selector);
  const local = chain.filter((c) => deps.models.runtime.isLocalProvider(c.provider));
  if (ctx.placement === 'local' && local.length === 0)
    return ok({ descriptions: [], uploadedTo: [], skipped: 'no_local_model' });
  if (ctx.placement === 'cloud') {
    if (!deps.settings) return ok({ descriptions: [], uploadedTo: [], skipped: 'no_consent' });
    const providers = [
      ...new Set(
        chain.filter((c) => !deps.models.runtime.isLocalProvider(c.provider)).map((c) => c.provider),
      ),
    ];
    const consent = await standingUploadConsent(deps.settings, 'vision', providers);
    if (!consent.ok) return consent;
    if (!consent.value) return ok({ descriptions: [], uploadedTo: [], skipped: 'no_consent' });
  }

  const uploadedTo = new Set<string>();
  const call = async (req: ModelRequest) => {
    const stream = deps.models.client.stream(req);
    for await (const event of stream) {
      // 'start' comes right before the request is sent: a failed cloud attempt still uploaded the frame.
      if (event.type === 'start' && !event.local) uploadedTo.add(event.provider);
    }
    return stream.result();
  };
  const ask: Ask = async (images, context, retry, times) => {
    const { system, text: asked, maxTokens } = shotRequest(images.length, context, retry, times);
    const request: ModelRequest = {
      module: 'vision',
      system,
      messages: [
        {
          role: 'user',
          content: shotContent(
            asked,
            images.map((image) => ({ type: 'image' as const, ...image })),
            times,
          ),
        },
      ],
      maxTokens,
      temperature: retry ? RETRY_TEMPERATURE : 0,
      reasoning: 'off',
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    };
    const result =
      ctx.placement === 'local'
        ? await callLocalOnly(deps.models.selector, deps.models.runtime, request, call)
        : await call(request);
    if (!result.ok) return result;
    const { text, provider, model, local: onDevice } = result.value;
    return ok({ text, model: { provider, model, local: onDevice } });
  };
  return describeEach(input, deps, ctx, ask, uploadedTo);
}

/** models' error when the embedded runtime isn't installed or running (the code crosses IPC as a string). */
const LOCAL_RUNTIME_UNAVAILABLE = 'models.local_runtime_unavailable';

export interface DescribeShotsOverPortDeps {
  readonly media: MediaContext;
  /** The asset's frame source (the job's); absent: each frame is extracted on its own. */
  readonly frames?: FrameSource;
  /** The agent's models over main (core's BackgroundModels): the jobs process has no model client. */
  readonly background: BackgroundModels;
}

/**
 * describeShots through core's BackgroundModels port. The agent process
 * applies the same placement rules (on-device only, or a standing consent
 * for every cloud provider) and says when it skipped.
 */
export async function describeShotsOverPort(
  input: DescribeShotsInput,
  deps: DescribeShotsOverPortDeps,
  ctx: DescribeShotsContext,
): AsyncResult<DescribeShotsOutput> {
  const uploadedTo = new Set<string>();
  const ask: Ask = async (images, context, retry, times) => {
    const { system, text: asked, maxTokens } = shotRequest(images.length, context, retry, times);
    const answer = await deps.background.complete(
      {
        module: 'vision',
        placement: ctx.placement,
        system,
        content: shotContent(
          asked,
          images.map((image) => ({ type: 'image' as const, ...image })),
          times,
        ),
        maxTokens,
        temperature: retry ? RETRY_TEMPERATURE : 0,
        reasoning: 'off',
      },
      ctx.signal,
    );
    // The profile has an on-device model whose runtime isn't installed (or is still starting): not yet, not a failure.
    if (!answer.ok && answer.error.code === LOCAL_RUNTIME_UNAVAILABLE)
      return ok({ skipped: 'not_yet' as const });
    if (!answer.ok) return answer;
    for (const provider of answer.value.uploadedTo) uploadedTo.add(provider);
    if (answer.value.status === 'skipped') return ok({ skipped: answer.value.reason });
    const { text, provider, model, local } = answer.value;
    return ok({ text, model: { provider, model, local } });
  };
  return describeEach(input, deps, ctx, ask, uploadedTo);
}

const framesOfShot = (shot: DescribeShotsInput['shots'][number]): readonly number[] =>
  shot.frames && shot.frames.length > 0 ? shot.frames : [shot.frame];

/** Each shot's frame(s), extracted and described in turn; stops at the first skip. */
async function describeEach(
  input: DescribeShotsInput,
  deps: { readonly media: MediaContext; readonly frames?: FrameSource },
  ctx: DescribeShotsContext,
  ask: Ask,
  uploadedTo: Set<string>,
): AsyncResult<DescribeShotsOutput> {
  const descriptions: { shotId: string; description: ShotDescription }[] = [];
  let model: DescribedBy | undefined;
  const done = (skipped?: Skip): DescribeShotsOutput => ({
    descriptions,
    ...(model ? { model } : {}),
    uploadedTo: [...uploadedTo],
    ...(skipped ? { skipped } : {}),
  });
  const frames = shotFrames(input, deps, ctx.signal);
  for (const [n, shot] of input.shots.entries()) {
    if (ctx.signal?.aborted) return err(CancelledError());
    const indices = framesOfShot(shot);
    if (n === 0 && indices.length > 1) await frames.ahead(indices);
    const images: FrameImage[] = [];
    for (const index of indices) {
      const frame = await frames.read(index);
      if (!frame.ok) return frame;
      images.push(frame.value);
    }
    // MOM1: a shot's frames with their times, when the stage gave its span: the answer carries its moments.
    const fps = input.rate.num / input.rate.den;
    const span: MomentSpan | undefined =
      shot.span && indices.length > 1 && fps > 0
        ? { length: shot.span.length, fps, frames: indices.length }
        : undefined;
    const times: FrameTimes | undefined = span
      ? { at: indices.map((index) => (index - shot.span!.start) / fps), seconds: span.length / fps }
      : undefined;
    const answer = await askWithOneRetry(ask, images, shot.context, times, span);
    if (!answer.ok) return answer;
    if ('skipped' in answer.value) return ok(done(answer.value.skipped));
    const { parsed, moments } = answer.value;
    model = answer.value.model;
    const actions = shotActions({
      answer: parsed.actions,
      sentence: parsed.description,
      ...(shot.context?.still ? { still: true } : {}),
    });
    descriptions.push({
      shotId: shot.shotId,
      description: {
        text: parsed.description,
        objects: parsed.objects,
        ...(actions.length > 0 ? { actions } : {}),
        ...(parsed.place ? { place: parsed.place } : {}),
        ...(parsed.shotType ? { shotType: parsed.shotType } : {}),
        ...(parsed.people !== undefined ? { people: parsed.people } : {}),
        ...(moments ? { moments } : {}),
        model,
      },
    });
    // The model answers: read the rest ahead, together.
    if (n === 0) await frames.ahead(input.shots.slice(1).flatMap(framesOfShot));
    ctx.progress?.((n + 1) / input.shots.length);
  }
  return ok(done());
}

type Answered = {
  model: DescribedBy;
  parsed: z.output<typeof describeAnswerSchema>;
  moments: ShotMoment[] | null;
};

/**
 * One ask, and one more when the answer can't be used. MOM1: an answer whose sentence is fine but whose moments
 * aren't (`span`: they were asked for) is asked once more too; if the second is no better, the first stands without
 * moments, so a shot never loses its description to them.
 */
async function askWithOneRetry(
  ask: Ask,
  images: readonly FrameImage[],
  context: ShotContext | undefined,
  times?: FrameTimes,
  span?: MomentSpan,
): AsyncResult<Answered | { skipped: Skip }> {
  let detail = '';
  let retry: string | undefined;
  let kept: Answered | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await ask(images, context, retry, times);
    if (!result.ok) return kept ? ok(kept) : result;
    if ('skipped' in result.value) return ok({ skipped: result.value.skipped });
    const parsed = parseDescription(result.value.text, attempt > 0);
    if (parsed?.success) {
      const moments = span ? shotMoments(parsed.data.moments, span) : null;
      const answered = { model: result.value.model, parsed: parsed.data, moments };
      if (!span || moments || attempt > 0) return ok(moments || !kept ? answered : kept);
      kept = answered;
      retry = retryNote('it had no usable "moments": give each a "fromFrame", a "toFrame" and a "note"');
      continue;
    }
    if (kept) return ok(kept);
    detail = parsed ? parsed.error.message.slice(0, 300) : 'no JSON object in the answer';
    retry = retryNote(parsed ? answerProblem(parsed.error) : 'it had no JSON object');
  }
  return kept ? ok(kept) : err(ModelOutputInvalid(undefined, { detail }));
}
