// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the keys the background work sends: each job kind's
 * progress stage (`JobProgress.stageKey`, `jobs.stage.<stage>`, shown by
 * progress cards through @taalcut/ui's stageLabel) and why an indexing
 * stage was skipped or is waiting (`indexing.skip.<reason>`, the library's
 * `library.stage.<reason>`). Media, vision, audio, library, templates and
 * render carry keys, never English, so the renderer owns the words.
 * Explicit ids: the backend names them. A few stage keys already have words
 * where they are used (packages/ui labels.ts, renders/render-messages.ts).
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const JOB_STAGE_MESSAGES: readonly MessageDescriptor[] = [
  // Media (media's MEDIA_JOB_STAGES and PHASE2_STAGES).
  msg({ id: 'jobs.stage.readingMediaInfo', message: 'Reading the clip' }),
  msg({ id: 'jobs.stage.extractingFrame', message: 'Taking a frame from the clip' }),
  msg({ id: 'jobs.stage.testingEncoder', message: 'Checking the video encoder' }),
  msg({ id: 'jobs.stage.normalising', message: 'Preparing the clip' }),
  msg({ id: 'jobs.stage.makingProxy', message: 'Making a smooth preview copy' }),
  // media.previews draws the sound only; the frames are media.filmstrip's (UX2, round 2).
  msg({ id: 'jobs.stage.makingPreviews', message: 'Drawing the sound wave' }),
  msg({ id: 'jobs.stage.makingFilmstrip', message: 'Laying out the clip’s frames' }),
  msg({ id: 'jobs.stage.conforming', message: 'Preparing the clip for export' }),
  msg({ id: 'jobs.stage.enforcingCacheCap', message: 'Clearing old previews' }),
  // Vision (VISION_JOB_STAGES and the breakdown's kinds).
  msg({ id: 'jobs.stage.analysingShots', message: 'Looking at each shot' }),
  msg({ id: 'jobs.stage.embedding', message: 'Indexing for search' }),
  msg({ id: 'jobs.stage.describingShots', message: 'Describing the shots' }),
  msg({ id: 'jobs.stage.groupingDuplicates', message: 'Finding repeated takes' }),
  msg({ id: 'jobs.stage.detectingCuts', message: 'Finding the cuts' }),
  msg({ id: 'jobs.stage.readingText', message: 'Reading the text on screen' }),
  msg({ id: 'jobs.stage.makingContactSheet', message: 'Laying out the shots' }),
  // Audio (AUDIO_JOB_STAGES).
  msg({ id: 'jobs.stage.measuringAudio', message: 'Measuring the sound' }),
  msg({ id: 'jobs.stage.detectingLanguage', message: 'Hearing which language is spoken' }),
  msg({ id: 'jobs.stage.transcribing', message: 'Writing down speech' }),
  msg({ id: 'jobs.stage.trackingBeats', message: 'Finding the beat' }),
  msg({ id: 'jobs.stage.analysingSpeech', message: 'Finding pauses and filler words' }),
  // Templates (the breakdown and the reference fetcher).
  msg({ id: 'jobs.stage.preparingReference', message: 'Preparing the reference' }),
  msg({ id: 'jobs.stage.findingCuts', message: 'Finding the cuts' }),
  msg({ id: 'jobs.stage.findingTransitions', message: 'Finding the transitions' }),
  // EAR1-C1: the breakdown hears the reel's sound against its cuts.
  msg({ id: 'jobs.stage.listening', message: 'Listening to the sound' }),
  msg({ id: 'jobs.stage.installingFetcher', message: 'Getting the link downloader ready' }),
  msg({ id: 'jobs.stage.fetchingReference', message: 'Downloading the reference' }),

  // Why an indexing stage was skipped for a clip (IndexStageDefinition.job → { skip }).
  msg({ id: 'indexing.skip.noShots', message: 'No shots were found in this clip' }),
  msg({ id: 'indexing.skip.notAnalysed', message: 'Nothing was found to look at in this clip' }),
  msg({ id: 'indexing.skip.noAudio', message: 'This clip has no sound' }),
  msg({ id: 'indexing.skip.silent', message: 'Nobody speaks in this clip' }),
  // LIB1-LANG: Odia and the other languages no engine here writes out yet.
  msg({
    id: 'indexing.skip.cannotTranscribe',
    message: 'Taalcut can’t write out speech in this language yet',
  }),
  msg({ id: 'indexing.skip.noVideo', message: 'This clip has no picture' }),
  msg({ id: 'indexing.skip.noText', message: 'No text on screen in this clip' }),
  msg({ id: 'indexing.skip.textRead', message: 'The text on screen was already read' }),
  msg({
    id: 'indexing.skip.transcriptProvided',
    message: 'Its words came with the voice Taalcut made, so there was nothing to transcribe',
  }),
  msg({ id: 'indexing.skip.noPlan', message: 'This clip couldn’t be prepared, so it has no previews' }),
  // Why a stage waits (the library's own reasons).
  msg({
    id: 'library.stage.originalOffline',
    message: 'Waiting for the original: reconnect its drive or download it from iCloud',
  }),
  msg({ id: 'library.stage.modelMissing', message: 'Waiting for its model to finish downloading' }),
  // A finished step whose file the media cache let go (UX2, round 2): made again when the clip is opened.
  msg({
    id: 'library.stage.fileEvicted',
    message: 'Its file was let go to save space; it’s made again when the clip is opened',
  }),

  // Why a file failed to come in (UX1-IMPORT): media's errors from the stages that read the file, said per file
  // when See which lists them (@taalcut/ui failureReason finds them in the catalogue by their message key).
  msg({
    id: 'errors.media.probe_failed',
    message: 'Taalcut couldn’t read this file. It may be damaged or only partly copied.',
  }),
  msg({
    id: 'errors.media.unsupported_media',
    message: 'This file is in a format Taalcut doesn’t read yet.',
  }),
  msg({
    id: 'errors.media.decode_failed',
    message: 'Part of this clip couldn’t be decoded. It may be damaged.',
  }),
  msg({
    id: 'errors.media.still_decode_failed',
    message: 'This photo couldn’t be opened. It may be damaged.',
  }),
  msg({
    id: 'errors.media.file_not_found',
    message: 'The file was moved or deleted before Taalcut could read it.',
  }),

  // Why a speech step failed when no speech engine could run (audio's EngineUnavailable, whichever engine): said on
  // the clip page above its Analyse again (UX2, round 5). The engine is in the error's params, not the words.
  msg({
    id: 'errors.audio.engine_unavailable',
    message:
      'The speech engine isn’t available right now. Analyse the clip again, and if it still fails, check Speech in Settings › Models.',
  }),
];

const BY_ID: ReadonlyMap<string, MessageDescriptor> = new Map(
  JOB_STAGE_MESSAGES.flatMap((descriptor) => (descriptor.id ? [[descriptor.id, descriptor] as const] : [])),
);

/** The words for an indexing reason key, or undefined for one this file doesn't know. */
export function indexingReasonText(i18n: I18n, key: string): string | undefined {
  const descriptor = BY_ID.get(key);
  return descriptor ? i18n._(descriptor) : undefined;
}
