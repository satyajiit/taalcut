// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One listening analysis (EAR1-F7): a file or decoded audio in, `SoundAnalysis` out. The models' builds are looked
 * up first (plan.ts; no session opens for that), then the cache: a hit returns at once, with nothing decoded and no
 * session opened. Otherwise the sound is decoded once (source.ts) and only what was asked for runs: F6's DSP on the
 * spectrogram runner (events, cut sync, measures with the key and the beat grid, the audit) and F4/F5's models
 * (tags, sections) and the lanes' realness and critique (extensions.ts). With `optionalModels`, a model that can't
 * run here, or fails while running, leaves its parts null (a partial critique) instead of failing (model-parts.ts).
 *
 * EAR1-R1: the request's signal reaches every stage. The DSP stops at its checkpoints (abort.ts), the spectrogram
 * runner between slices of rows (dsp/abortable-runner.ts); an abort returns core.cancelled within a slice's time.
 * An analysis that left a model part out for a reason that may pass is not cached.
 */
import {
  CancelledError,
  err,
  ok,
  RationalTime,
  RENDER_LISTENING_EVENTS_MAX,
  type AsyncResult,
  type SoundEvent,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { checkpoint, unwindOnAbort } from '../abort';
import { LISTEN_CONFIG } from '../config';
import { abortableRunner } from '../dsp/abortable-runner';
import { auditSound, toSoundAuditReport } from '../dsp/audit';
import { estimateKey } from '../dsp/key';
import { measureSound, toSoundMeasures } from '../dsp/measure';
import { monoOf, stereoOf, type ListenAudio } from '../dsp/pcm';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { musicGrid } from '../dsp/tempo-grid';
import { ListenBadInput, ListenUnavailable } from '../errors';
import { analyseEvents, toSoundEvents, withBeatOffsets } from '../timeline/events';
import { syncToCuts, toCutSyncReport } from '../timeline/sync';
import { fileContentHash, listenCacheKey, pcmContentHash, type ListenAnalysisCache } from './cache';
import type { RealnessScorer, SoundCritic } from './hooks';
import { modelParts, optionalFailure } from './model-parts';
import { planModels, type ListenModelSet, type ModelPlan } from './plan';
import type { ListenOptions, SoundAnalysis } from './schema';
import { decodeListenSource, listenSourceOf, sliceListenAudio, type DecodedListen } from './source';

export { LISTEN_CHECKPOINTS, type ListenModelSet } from './plan';

const SR = LISTEN_CONFIG.sampleRate;

export interface ListenAnalysisDeps {
  /** FFmpeg, to decode a path. */
  readonly media?: () => AsyncResult<MediaContext>;
  /** The process's spectrogram runner (createSpectrogramRunner on the listen device plan). */
  readonly spectrograms: () => Promise<SpectrogramRunner>;
  /** The models; absent where none can run (signal processing only). */
  readonly models?: () => Promise<ListenModelSet>;
  readonly cache?: ListenAnalysisCache;
  /** Lane A1's realness (extensions.ts); without it `realness` stays null. */
  readonly realness?: RealnessScorer;
  /** Lane A1/A2's critique (extensions.ts); without it `critique` stays null. */
  readonly critique?: SoundCritic;
  /** One line when a model part is left out because its model failed (`optionalModels`). */
  readonly log?: (line: string) => void;
}

export interface AnalyseSoundRequest extends ListenOptions {
  /** A file to decode (with `deps.media`), or `pcm`: decoded 48 kHz audio, one channel or two. */
  readonly path?: string;
  readonly pcm?: ListenAudio;
  /** The library's content hash, when known: the cache key without reading the file. */
  readonly contentHash?: string;
  readonly signal?: AbortSignal;
}

/** Only the options (what the cache key covers), without the audio and the signal. */
function optionsOf(request: AnalyseSoundRequest): ListenOptions {
  const { path: _path, pcm: _pcm, contentHash: _hash, signal: _signal, ...options } = request;
  return options;
}

async function contentHashOf(request: AnalyseSoundRequest): AsyncResult<string> {
  if (request.contentHash) return ok(request.contentHash);
  if (request.pcm) return ok(pcmContentHash(request.pcm));
  return fileContentHash(request.path ?? '', request.signal);
}

async function decode(deps: ListenAnalysisDeps, request: AnalyseSoundRequest): AsyncResult<DecodedListen> {
  if (request.pcm) {
    if (request.pcm.sampleRate !== SR || (request.pcm.channels[0]?.length ?? 0) === 0)
      return err(ListenBadInput(undefined, { detail: `decoded audio must be non-empty ${SR} Hz` }));
    const audio = request.range ? sliceListenAudio(request.pcm, request.range) : request.pcm;
    if ((audio.channels[0]?.length ?? 0) === 0)
      return err(ListenBadInput(undefined, { detail: 'the range holds no audio: it starts past the end' }));
    return ok(listenSourceOf(audio));
  }
  if (!deps.media) return err(ListenUnavailable({ reason: 'no_decoder' }));
  const media = await deps.media();
  if (!media.ok) return media;
  return decodeListenSource(request.path ?? '', {
    media: media.value,
    ...(request.range ? { range: request.range } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });
}

export async function analyseSound(
  deps: ListenAnalysisDeps,
  request: AnalyseSoundRequest,
): AsyncResult<SoundAnalysis> {
  const { signal } = request;
  if (signal?.aborted) return err(CancelledError());
  if (!request.path === !request.pcm)
    return err(ListenBadInput(undefined, { detail: 'give either a path or decoded audio' }));
  const options = optionsOf(request);
  const plan = await planModels(deps.models, options, signal);
  if (!plan.ok) return plan;
  let key: string | undefined;
  if (deps.cache) {
    const hash = await contentHashOf(request);
    if (!hash.ok) return hash;
    key = listenCacheKey(hash.value, plan.value.id, options);
    const hit = await deps.cache.get(key, signal);
    if (hit) return ok(hit);
  }
  return unwindOnAbort(signal, async () => {
    const decoded = await decode(deps, request);
    if (!decoded.ok) return decoded;
    const analysed = await runAnalysis(deps, decoded.value, options, plan.value, signal);
    if (!analysed.ok) return analysed;
    // A model part left out for a reason that may pass (a failed install, a GPU error) is tried again next time.
    if (deps.cache && key && !analysed.value.transient)
      await deps.cache.put(key, analysed.value.analysis, signal);
    return ok(analysed.value.analysis);
  });
}

/** The most prominent events, in time order, when there are more than a listening keeps. */
function capEvents(events: readonly SoundEvent[]): SoundEvent[] {
  if (events.length <= RENDER_LISTENING_EVENTS_MAX) return [...events];
  const kept = new Set(
    [...events].sort((a, b) => b.prominenceDb - a.prominenceDb).slice(0, RENDER_LISTENING_EVENTS_MAX),
  );
  return events.filter((event) => kept.has(event));
}

async function runAnalysis(
  deps: ListenAnalysisDeps,
  decoded: DecodedListen,
  options: ListenOptions,
  plan: ModelPlan,
  signal?: AbortSignal,
): AsyncResult<{ readonly analysis: SoundAnalysis; readonly transient: boolean }> {
  const { audio, source } = decoded;
  const { want } = options;
  const log = deps.log ?? (() => undefined);
  // Every stage stops at the signal: between stages here, and inside them (their checkpoints and the runner's).
  const runner = abortableRunner(await deps.spectrograms(), signal);
  const stop = signal ? { signal } : {};
  const length = audio.channels[0]?.length ?? 0;
  const durationS = length / SR;
  const mono = monoOf(stereoOf(audio));
  const music = durationS >= 5;
  const cuts = options.cuts?.map((cut) => RationalTime.toSeconds(cut));
  const startsFile = !options.range || RationalTime.toSeconds(options.range.start) === 0;
  const detected =
    want.events || cuts ? await analyseEvents(audio, runner, { lead: startsFile, ...stop }) : undefined;
  await checkpoint(signal);
  const grid = want.tempo && music ? await musicGrid(mono, runner) : undefined;
  await checkpoint(signal);
  const key = want.key && music ? await estimateKey(mono, runner) : undefined;
  await checkpoint(signal);
  const given = options.beats?.map((beat) => RationalTime.toSeconds(beat)) ?? [];
  const beats = given.length > 0 ? given : grid && grid.confidence !== 'none' ? grid.beats : [];
  let measures: SoundAnalysis['measures'] = null;
  if (want.measures || want.key || want.tempo) {
    const measured = await measureSound(audio, runner, {
      ...(detected ? { kPower: detected.kPower } : {}),
      ...stop,
    });
    measures = toSoundMeasures({ ...measured, ...(grid ? { grid } : {}), ...(key ? { key } : {}) });
  }
  const timed = detected ? withBeatOffsets(detected.events, beats) : [];
  const cutSync =
    detected && cuts && options.cuts
      ? toCutSyncReport(
          syncToCuts(cuts, detected.events, {
            ...(options.frameRate ? { frameRate: options.frameRate } : {}),
            beats,
            levels: detected.levels,
            durationS,
          }),
          { ...(options.frameRate ? { frameRate: options.frameRate } : {}), cuts: options.cuts },
        )
      : null;
  await checkpoint(signal);
  const audit = want.audit ? toSoundAuditReport(await auditSound(audio, runner, stop)) : null;
  await checkpoint(signal);

  const heard = await modelParts(
    { ...(deps.realness ? { realness: deps.realness } : {}), log },
    decoded,
    options,
    plan,
    runner,
    signal,
  );
  if (!heard.ok) return heard;
  let transient = plan.transient || heard.value.transient;
  const analysis: SoundAnalysis = {
    measures,
    events: want.events ? capEvents(toSoundEvents(timed)) : [],
    sections: heard.value.sections,
    cutSync,
    audit,
    tags: heard.value.tags,
    realness: heard.value.realness,
    critique: null,
    model: heard.value.ran ? plan.model : null,
  };
  if (!options.critique || !deps.critique) return ok({ analysis, transient });
  await checkpoint(signal);
  const critique = await deps.critique({
    audio,
    source,
    spectrograms: runner,
    models: heard.value.ran ? (plan.set?.models ?? null) : null,
    ...stop,
    analysis,
    cuts: options.cuts ?? [],
    beats: options.beats ?? [],
    ...(options.frameRate ? { frameRate: options.frameRate } : {}),
    request: options.critique,
    // The plan decided (and the key says) whether AST runs for the music share.
    mayLoad: async (name) => plan.available.has(name),
    ...(options.optionalModels ? { optionalModels: true } : {}),
    skipped: (part, error) => {
      transient = true;
      log(`[listen] critique's ${part} left out (${error.code}): ${(error.detail ?? '').slice(0, 200)}`);
    },
  });
  if (critique.ok) return ok({ analysis: { ...analysis, critique: critique.value }, transient });
  if (!optionalFailure(options, critique.error)) return critique;
  log(`[listen] critique left out (${critique.error.code}): ${(critique.error.detail ?? '').slice(0, 200)}`);
  return ok({ analysis, transient: true });
}
