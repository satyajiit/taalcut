// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for the indexing kinds: language ID (identify-handler.ts) and the transcript kinds, one per engine
 * plus the pre-IX one that picks its engine itself (transcript-handler.ts). They share the jobs process's audio
 * store, so an asset is decoded once for both stages.
 */
import { registerJob, type JobRegistration } from '@taalcut/core';
import type { AudioIndexJobDeps } from './deps';
import { identifyLanguage } from './identify-handler';
import {
  audioIdentifyLanguageJob,
  audioTranscribeAssetJob,
  audioTranscribeAssetParakeetJob,
  audioTranscribeAssetWhisperJob,
} from './index-kinds';
import { transcribeAsset } from './transcript-handler';

export function createAudioIndexJobs(deps: AudioIndexJobDeps): readonly JobRegistration[] {
  return [
    registerJob(audioIdentifyLanguageJob, (input, context) => identifyLanguage(deps, input, context)),
    registerJob(audioTranscribeAssetWhisperJob, (input, context) =>
      transcribeAsset(deps, input, context, 'whisper'),
    ),
    registerJob(audioTranscribeAssetParakeetJob, (input, context) =>
      transcribeAsset(deps, input, context, 'parakeet'),
    ),
    registerJob(audioTranscribeAssetJob, (input, context) => transcribeAsset(deps, input, context, 'route')),
  ];
}
