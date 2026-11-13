// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's language and transcript jobs as stand-ins for the desktop's indexing tests (the synthetic reel has no
 * sound): English speech, "sale on today" over the first two seconds, or none once the clip is silent. Each job
 * can also find its model missing (as whisper's handlers say it, `audio.model_missing`) or break the way a crashed
 * decode does, which is not a model's fault.
 */
import { audioIdentifyLanguageJob, audioTranscribeAssetWhisperJob, ModelMissing } from '@taalcut/audio';
import {
  defineError,
  err,
  ok,
  RationalTime,
  registerJob,
  TimeRange,
  type JobRegistration,
  type Result,
} from '@taalcut/core';

/** What a stand-in job does: its work, find its model missing, or break. */
export type StandIn = 'ok' | 'missing' | 'broken';

export interface AudioWorld {
  silent: boolean;
  /** `audio.language`'s job, which needs whisper's tiny model. */
  language: StandIn;
  /** `audio.transcript`'s job, which needs the speech model. */
  transcript: StandIn;
}

/** What the reel says. */
export const SAID = 'sale on today';

const DecodeCrashed = defineError('test.decode_crashed');
const RATE = { num: 30, den: 1 };
const MEASURE = {
  integratedLufs: -20,
  loudnessRange: 4,
  truePeakDbtp: -2,
  nonSilentRatio: 0.9,
  nonSilentMs: 6300,
  durationMs: 7000,
};
const ENGLISH = { language: 'en', probability: 0.9 };

/** The job's work, unless the world says its model is missing or it breaks. */
function standIn<T>(job: StandIn, component: string, work: () => T): Promise<Result<T>> {
  if (job === 'missing') return Promise.resolve(err(ModelMissing({ component })));
  if (job === 'broken') return Promise.resolve(err(DecodeCrashed()));
  return Promise.resolve(ok(work()));
}

export function audioJobs(world: AudioWorld): JobRegistration[] {
  return [
    registerJob(audioIdentifyLanguageJob, () =>
      standIn(world.language, 'whisper-tiny', () =>
        world.silent
          ? {
              silent: true,
              measure: { ...MEASURE, nonSilentRatio: 0, nonSilentMs: 0 },
              detected: { language: null, probability: null, perSlice: [] },
            }
          : { silent: false, measure: MEASURE, detected: { ...ENGLISH, perSlice: [ENGLISH] } },
      ),
    ),
    registerJob(audioTranscribeAssetWhisperJob, () =>
      standIn(world.transcript, 'whisper-medium-q5-0', () => ({
        version: 1 as const,
        language: 'en',
        engine: 'whisper' as const,
        model: 'whisper-test',
        local: true,
        wordTiming: 'native' as const,
        segments: [
          {
            text: SAID,
            range: TimeRange.of(RationalTime.of(0, RATE), RationalTime.of(60, RATE)),
            words: [],
            language: 'en',
          },
        ],
      })),
    ),
  ];
}
