// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's index stages (P2-L13 contract, core `defineIndexStage`), in the
 * library SPEC's table: `audio.language` (measure, voice, language id) after
 * media's normalise, and `audio.transcript` after it, as the kind of the engine
 * the language routes to (IX-A4: Parakeet when it is installed and speaks the
 * language, whisper otherwise); plus `audio.beats` for music files, whose beat
 * map the library stores on the asset (IndexStageResult.beats) for the
 * timeline's re-time to the user's track. Both speech stages pass normalise's
 * stored plan, so the audio pass needs no probe of its own. Each says which
 * stages' stored output it reads (round IX3): when one stores something else,
 * it runs again, so a clip that turns silent loses its transcript and the
 * transcript's vectors.
 */
import type { z } from 'zod';
import {
  defineIndexStage,
  ok,
  spokenLanguageOutcomeSchema,
  stageJob,
  transcriptSchema,
  type AssetIndexView,
  type IndexStageDefinition,
  type SpokenLanguageOutcome,
} from '@taalcut/core';
import { storedPlan } from '@taalcut/media';
import {
  audioIdentifyLanguageJob,
  audioTranscribeAssetParakeetJob,
  audioTranscribeAssetWhisperJob,
  identifyLanguageOutputSchema,
  type IdentifyLanguageOutput,
} from './index-kinds';
import { audioTrackBeatsJob } from './kinds';
import { AUDIO_CONFIG } from '../config';
import { routeTranscription } from '../speech/route';
import { whisperCodeFor } from '../speech/whisper-languages';

/** Skip reasons (i18n keys, renderer catalogue). */
export const AUDIO_SKIP = {
  noAudio: 'indexing.skip.noAudio',
  silent: 'indexing.skip.silent',
  /** LIB1-LANG: the speech is in a language no engine here writes out (Odia): "Taalcut can't write out … yet". */
  cannotTranscribe: 'indexing.skip.cannotTranscribe',
} as const;

/**
 * LIB1-LANG: the language stage's version, one past the others: every clip's language is decided again (the floor,
 * the Indian-language identifier, the person's languages), and its transcript follows when the decision changed.
 */
const LANGUAGE_VERSION = AUDIO_CONFIG.version + 1;

const LANGUAGE = 'audio.language';

/** What `audio.language` stored for this asset, if it ran. */
export function storedLanguage(view: AssetIndexView): IdentifyLanguageOutput | undefined {
  const parsed = identifyLanguageOutputSchema.safeParse(view.outputs[LANGUAGE]);
  return parsed.success ? parsed.data : undefined;
}

const noAudio = (view: AssetIndexView) => view.facts !== null && !view.facts.hasAudio;

export interface AudioIndexStageOptions {
  /** Parakeet's model and the helper that runs it are installed (read per job). Absent: never. */
  readonly parakeetReady?: () => boolean;
}

/** What `audio.language` stores that later stages read: silent or not, and the language it detected (round IX3). */
function storedIdentification(view: AssetIndexView) {
  const identified = storedLanguage(view);
  return identified
    ? {
        silent: identified.silent,
        detected: identified.detected,
        decision: identified.decision?.state ?? null,
      }
    : null;
}

/** What the library files the clip under: the decision without its source; none before LIB1. */
export function spokenLanguageOf(identified: IdentifyLanguageOutput): SpokenLanguageOutcome | undefined {
  const decision = identified.decision;
  if (!decision) return undefined;
  const outcome = { state: decision.state, languages: decision.languages, confidence: decision.confidence };
  return spokenLanguageOutcomeSchema.safeParse(outcome).success ? outcome : undefined;
}

/** The clip's one language, when no engine here can write it out (Odia); mixed speech goes to whisper's auto. */
export function untranscribable(identified: IdentifyLanguageOutput): string | undefined {
  const named = identified.detected.perSlice.map((slice) => slice.language);
  const first = named[0];
  if (!first || named.length > 1) return undefined;
  return whisperCodeFor(first) ? undefined : first;
}

/** The engine the detected languages route to; the tier only picks whisper's size, so it is not asked. */
export function transcriptEngine(identified: IdentifyLanguageOutput): 'parakeet' | 'whisper' {
  const route = routeTranscription(
    { language: identified.detected.language, probability: null, perSlice: identified.detected.perSlice },
    { tier: 'recommended', cloudFirst: false, consent: false },
  );
  return route.engine === 'parakeet' ? 'parakeet' : 'whisper';
}

/** `audio.transcript`: the kind of the engine the stored language routes to, or a skip. */
function transcriptStage(options: AudioIndexStageOptions): IndexStageDefinition {
  return defineIndexStage({
    stage: 'audio.transcript',
    version: AUDIO_CONFIG.version,
    reads: [LANGUAGE, 'media.normalise'],
    // The transcript (null: nothing said), which vision.embedText embeds.
    stores: (view) => view.transcript,
    needs: [LANGUAGE],
    appliesTo: ['video', 'audio'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) => {
      const identified = storedLanguage(view);
      if (!identified || noAudio(view)) return { skip: AUDIO_SKIP.noAudio };
      if (identified.silent) return { skip: AUDIO_SKIP.silent };
      if (untranscribable(identified)) return { skip: AUDIO_SKIP.cannotTranscribe };
      const plan = storedPlan(view);
      const input = {
        path: view.path,
        contentHash: view.contentHash,
        ...(plan ? { plan } : {}),
        perSlice: identified.detected.perSlice,
        // Mixed speech has no one language: the transcript isn't forced into one (route.ts).
        language: identified.decision?.state === 'mixed' ? null : identified.detected.language,
      };
      const parakeet = transcriptEngine(identified) === 'parakeet' && (options.parakeetReady?.() ?? false);
      return parakeet
        ? stageJob(audioTranscribeAssetParakeetJob, input)
        : stageJob(audioTranscribeAssetWhisperJob, input);
    },
    // The clip's language is the language stage's decision (LIB1-LANG): the transcript's own guess no longer files it.
    result: (output) => ok({ transcript: transcriptSchema.parse(output) }),
  });
}

export function createAudioIndexStages(options: AudioIndexStageOptions = {}): IndexStageDefinition[] {
  const language = defineIndexStage({
    stage: LANGUAGE,
    version: LANGUAGE_VERSION,
    reads: ['media.normalise'],
    stores: storedIdentification,
    needs: ['media.normalise'],
    appliesTo: ['video', 'audio'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) => {
      if (noAudio(view)) return { skip: AUDIO_SKIP.noAudio };
      const plan = storedPlan(view);
      return stageJob(audioIdentifyLanguageJob, {
        path: view.path,
        contentHash: view.contentHash,
        ...(plan ? { plan } : {}),
        // The language the person chose for the clip: obeyed, not detected (library.setAssetLanguage).
        ...(view.chosenLanguage ? { language: view.chosenLanguage } : {}),
      });
    },
    result: (output) => {
      const out = identifyLanguageOutputSchema.parse(output);
      // No speech: the asset's transcript is null, so search and captions know there is nothing to read.
      if (out.silent) return ok({ transcript: null });
      const spokenLanguage = spokenLanguageOf(out);
      return ok({
        ...(out.detected.language ? { language: out.detected.language } : {}),
        ...(spokenLanguage ? { spokenLanguage } : {}),
        // No engine here writes this language out (Odia): a transcript made earlier in another language goes, so
        // search doesn't find words nobody said. The transcript stage skips with the honest line.
        ...(untranscribable(out) ? { transcript: null } : {}),
      });
    },
  });

  const transcript = transcriptStage(options);

  const beats = defineIndexStage({
    stage: 'audio.beats',
    // One past the others: from here the beat map is stored on the asset, so music indexed before reruns.
    version: AUDIO_CONFIG.version + 1,
    reads: ['media.normalise'],
    needs: ['media.normalise'],
    appliesTo: ['audio'],
    priority: 'low',
    milestone: 'complete',
    job: (view) => {
      if (noAudio(view)) return { skip: AUDIO_SKIP.noAudio };
      return stageJob(audioTrackBeatsJob, { path: view.path, contentHash: view.contentHash });
    },
    result: (output) => ok({ beats: (output as z.output<typeof audioTrackBeatsJob.output>).beatMap }),
  });

  return [language, transcript, beats];
}
