// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.identifyLanguage` (IX-A1, IX-A2): the asset's audio pass (one decode: loudness, silences, the speech
 * PCM), then Silero VAD over the non-silent stretches until one window holds enough voice, then one whisper
 * language ID on that window. Nobody speaking (too little voice in the whole asset) is `silent`, so neither
 * language ID nor the transcript runs. The PCM is kept for the transcript, which reads the same file; a silent
 * or failed asset's is removed at once.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type JobContext } from '@taalcut/core';
import type { NormalisationPlan } from '@taalcut/media';
import { writePcmRange, type SpeechPcm } from '../asset-audio/wav-file';
import type { Span } from '../cleanup/segments';
import { AUDIO_CONFIG, LANGUAGE_WINDOW } from '../config';
import { ModelMissing, NoAudio } from '../errors';
import { measureOfPass } from '../measure/pass-measure';
import { languageWindow, totalSpeechMs } from '../speech/language-window';
import { laterPieces } from '../speech/indic-lid';
import { identifyCascade, MAX_LATER_PIECES } from './identify-cascade';
import { scanSpeech } from '../speech/speech-scan';
import { createCliWhisperDecoder } from '../whisper/cli-decoder';
import type { WhisperDecoder } from '../whisper/decoder';
import type { AudioIndexJobDeps } from './deps';
import type { IdentifyLanguageOutput } from './index-kinds';
import { AUDIO_JOB_STAGES, reportStage as stage } from './kinds';

type Measure = IdentifyLanguageOutput['measure'];
type SpeechDetail = NonNullable<IdentifyLanguageOutput['speech']>;
/** Where the voice is, and (Silero's scan) the voice itself, for the identifier's pieces. */
type HeardVoice = SpeechDetail & { readonly spans?: readonly Span[] };

export interface IdentifyInput {
  readonly path: string;
  readonly contentHash?: string | undefined;
  readonly plan?: NormalisationPlan | undefined;
  readonly language?: string | undefined;
}

const NO_LANGUAGE = { language: null, probability: null, perSlice: [] };

const SILENT_MEASURE: Measure = {
  integratedLufs: -70,
  loudnessRange: 0,
  truePeakDbtp: -70,
  nonSilentRatio: 0,
  nonSilentMs: 0,
  durationMs: 0,
};

/** The decoder language ID runs on: the persistent one, else whisper-cli; undefined when neither is installed. */
function languageDecoder(deps: AudioIndexJobDeps): WhisperDecoder | undefined {
  if (deps.decoder) return deps.decoder;
  if (!deps.whisper.binary) return undefined;
  return createCliWhisperDecoder({
    binary: deps.whisper.binary,
    ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
  });
}

/** Where the voice is, and the language-ID window: Silero's when it runs, the non-silent stretches otherwise. */
async function findVoice(
  deps: AudioIndexJobDeps,
  pcm: SpeechPcm,
  stretches: readonly Span[],
  signal: AbortSignal,
): AsyncResult<HeardVoice> {
  const { windowMs, enoughSpeechMs, padMs } = LANGUAGE_WINDOW;
  if (deps.vad) {
    const scan = await scanSpeech(pcm, deps.vad, {
      regions: stretches,
      windowMs,
      enoughSpeechMs,
      padMs,
      signal,
    });
    if (scan.ok) return ok({ ...scan.value, detector: 'silero' });
    if (scan.error.code === 'core.cancelled') return scan;
    deps.log?.(`[audio] voice scan failed (${scan.error.detail ?? scan.error.code}); using non-silent audio`);
  } else {
    deps.log?.('[audio] silero-vad is not installed; language ID listens to the non-silent audio');
  }
  const window = languageWindow(stretches, { windowMs, durationMs: pcm.durationMs, padMs });
  return ok({
    speechMs: totalSpeechMs(stretches),
    window: window ? { startMs: window.startMs, endMs: window.endMs } : null,
    scannedMs: 0,
    complete: true,
    detector: 'stretches',
  });
}

export async function identifyLanguage(
  deps: AudioIndexJobDeps,
  input: IdentifyInput,
  context: JobContext,
): AsyncResult<IdentifyLanguageOutput> {
  stage(context, 0, AUDIO_JOB_STAGES.measuring);
  const asset = { path: input.path, contentHash: input.contentHash, plan: input.plan };
  const lease = await deps.store.acquire(asset, deps.media, context.signal);
  if (!lease.ok) {
    // A file whose stream can't be read as audio has nothing to say: silent, not a failure.
    if (lease.error.code === NoAudio.code)
      return ok({ silent: true, measure: SILENT_MEASURE, detected: NO_LANGUAGE });
    return lease;
  }
  const { pass, dir } = lease.value;
  let keep = false;
  try {
    const { stretches, ...measure } = measureOfPass(pass);
    if (measure.nonSilentMs < AUDIO_CONFIG.silence.minNonSilentMs)
      return ok({ silent: true, measure, detected: NO_LANGUAGE });
    if (input.language) {
      keep = true;
      const slice = { language: input.language, probability: 1 };
      return ok({
        silent: false,
        measure,
        detected: { ...slice, perSlice: [slice] },
        decision: { state: 'chosen', languages: [input.language], confidence: null, source: 'chosen' },
      });
    }
    // Only now is whisper needed: a silent file never asks for it.
    const decoder = languageDecoder(deps);
    if (!decoder) return err(ModelMissing({ component: 'whisper-cpp' }));
    if (!deps.whisper.tiny) return err(ModelMissing({ component: 'whisper-tiny' }));

    stage(context, 0.2, AUDIO_JOB_STAGES.detecting);
    const speech = await findVoice(deps, pass.pcm, stretches, context.signal);
    if (!speech.ok) return speech;
    const window = speech.value.window;
    const { spans, ...where } = speech.value;
    if (!window || speech.value.speechMs < LANGUAGE_WINDOW.minSpeechMs)
      return ok({ silent: true, measure, detected: NO_LANGUAGE, speech: where });

    stage(context, 0.7, AUDIO_JOB_STAGES.detecting);
    const wav = join(dir, 'language.wav');
    const written = await writePcmRange(pass.pcm, window, wav);
    if (!written.ok) return written;
    const guess = await decoder
      .identifyLanguage({ audio: wav, model: deps.whisper.tiny, signal: context.signal })
      .finally(() => rm(wav, { force: true }));
    if (!guess.ok) return guess;
    stage(context, 0.85, AUDIO_JOB_STAGES.detecting);
    const cascade = await identifyCascade({
      guess: guess.value,
      pcm: pass.pcm,
      window,
      spans: where.detector === 'silero' ? spans : undefined,
      later: laterPieces(stretches, window, pass.pcm.durationMs, MAX_LATER_PIECES),
      spoken: (await deps.spokenLanguages?.()) ?? [],
      identifier: deps.indicLid,
      signal: context.signal,
      ...(deps.log ? { log: deps.log } : {}),
    });
    if (!cascade.ok) return cascade;
    keep = true;
    stage(context, 1, AUDIO_JOB_STAGES.detecting);
    const { decision, whisper, pieces } = cascade.value;
    const named = decision.state === 'unclear' ? [] : decision.languages;
    return ok({
      silent: false,
      measure,
      detected: {
        language: named[0] ?? null,
        probability: decision.confidence,
        perSlice: named.map((language) => ({ language, probability: decision.confidence ?? 0 })),
      },
      decision: { ...decision, languages: [...decision.languages] },
      whisper: [...whisper],
      ...(pieces ? { pieces: pieces.map((piece) => ({ ...piece, top: [...piece.top] })) } : {}),
      speech: where,
    });
  } finally {
    await lease.value.release(keep ? { keep: true } : undefined);
  }
}
