// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S3: every job kind the jobs process runs, with the hardware class whose budget it uses and the model
 * lane it shares (round IX, design A). Decode-bound work is `video`; each local model is one lane in its
 * class; cloud calls are `network`. Every lane a kind names is one the lane plan (models) gives a limit, so
 * a misspelt lane can't silently fall back to the default.
 */
import type { JobKind } from '@taalcut/core';
import {
  audioAnalyzeSpeechJob,
  audioDetectLanguageJob,
  audioIndexJobKinds,
  audioMeasureJob,
  audioTrackBeatsJob,
  audioTranscribeCloudJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
} from '@taalcut/audio';
import {
  collectJob,
  findMissingFilesJob,
  hashAssetJob,
  scanSourceJob,
  stockImportJob,
  sweepStagingJob,
} from '@taalcut/library';
import { mediaJobKinds } from '@taalcut/media';
import { MODEL_LANES } from '@taalcut/models';
import { renderExportJob, renderPurgeJob, trackSubjectsJob } from '@taalcut/render';
import { templatesBreakdownJob, templatesFetchReferenceJob } from '@taalcut/templates';
import { sandboxRunJob } from '@taalcut/tools';
import { visionJobKinds } from '@taalcut/vision';
import { describe, expect, it } from 'vitest';

type Kind = Pick<JobKind<never, unknown>, 'kind' | 'resource' | 'lane'>;

const KINDS: readonly Kind[] = [
  ...mediaJobKinds,
  ...visionJobKinds,
  ...audioIndexJobKinds,
  audioMeasureJob,
  audioDetectLanguageJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
  audioTranscribeCloudJob,
  audioTrackBeatsJob,
  audioAnalyzeSpeechJob,
  renderExportJob,
  renderPurgeJob,
  trackSubjectsJob,
  templatesFetchReferenceJob,
  templatesBreakdownJob,
  sandboxRunJob,
  scanSourceJob,
  hashAssetJob,
  findMissingFilesJob,
  sweepStagingJob,
  collectJob,
  stockImportJob,
];

/** kind → [class, lane]. */
const EXPECTED: Readonly<Record<string, readonly [string, string?]>> = {
  // Media: the video engine decodes and encodes; probes and cache housekeeping are I/O.
  'media.probe': ['io'],
  'media.extractFrame': ['video'],
  'media.selectEncoder': ['video'],
  'media.normalise': ['video'],
  'media.makeProxy': ['video'],
  'media.makePreviews': ['video'],
  'media.makeFilmstrip': ['video'],
  'media.makeThumbnail': ['video'],
  'media.conform': ['video'],
  'media.enforceCacheCap': ['io'],
  // Vision indexing: shots and analysis are decode-bound; each model is a lane.
  'vision.detectShots': ['video'],
  'vision.analyzeShots': ['video'],
  'vision.readShotText': ['npu', 'vision.ocr'],
  'vision.embedAsset': ['gpu', 'vision.embedder'],
  'vision.embedTexts': ['gpu', 'vision.embedder'],
  'vision.describeShots': ['gpu', 'models.llm'],
  'vision.describeShotsCloud': ['network'],
  'vision.indexContactSheet': ['video'],
  'vision.groupDuplicates': ['cpu'],
  // Vision breakdown and looks.
  'vision.detectCuts': ['video'],
  'vision.readOverlays': ['npu'],
  'vision.contactSheet': ['video'],
  'vision.measureLook': ['video'],
  'vision.bakeGrade': ['cpu'],
  // Audio: whisper (language ID and transcripts), Parakeet on the Neural Engine, Beat This!.
  'audio.identifyLanguage': ['gpu', 'audio.whisper'],
  'audio.transcribeAsset': ['gpu', 'audio.whisper'],
  'audio.transcribeAssetWhisper': ['gpu', 'audio.whisper'],
  'audio.transcribeAssetParakeet': ['npu', 'audio.parakeet'],
  'audio.measure': ['cpu'],
  'audio.detectLanguage': ['gpu', 'audio.whisper'],
  'audio.transcribeParakeet': ['npu', 'audio.parakeet'],
  'audio.transcribeWhisper': ['gpu', 'audio.whisper'],
  'audio.transcribeCloud': ['network'],
  'audio.trackBeats': ['gpu', 'audio.beats'],
  'audio.analyzeSpeech': ['cpu'],
  // Render: Metal compositing and the encode; subject tracking (Apple Vision) beside an export.
  'render.export': ['gpu'],
  'render.purge': ['io'],
  'render.trackSubjects': ['gpu'],
  // Templates: the fetch is a download; a breakdown runs the analysers in one job.
  'templates.fetchReference': ['network'],
  'templates.breakdown': ['gpu'],
  'sandbox.run': ['cpu'],
  // Library: scanning, hashing and housekeeping are I/O; stock downloads are network.
  'library.scanSource': ['io'],
  'library.hashAsset': ['io'],
  'library.findMissingFiles': ['io'],
  'library.sweepStaging': ['io'],
  'library.collect': ['io'],
  'library.stockImport': ['network'],
};

describe('job kinds: hardware class and model lane (design A)', () => {
  it('gives every kind the class and lane design A names', () => {
    const actual = Object.fromEntries(
      KINDS.map((k) => [k.kind, k.lane === undefined ? [k.resource] : [k.resource, k.lane]]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('names only lanes the lane plan gives a limit', () => {
    const lanes = new Set(KINDS.flatMap((k) => (k.lane === undefined ? [] : [k.lane])));
    expect([...lanes].filter((lane) => !(MODEL_LANES as readonly string[]).includes(lane))).toEqual([]);
    // And every planned lane has a kind (a lane nobody uses is a stale plan entry).
    expect(MODEL_LANES.filter((lane) => !lanes.has(lane))).toEqual([]);
  });
});
