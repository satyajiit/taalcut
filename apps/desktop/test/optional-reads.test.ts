// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Optional reads (LRN1-CTX, core `optionalReads`) with the library's real pipeline, vision's and audio's real stage
 * definitions and vision's real handlers on a synthetic reel (FFmpeg, software encoder, stand-in models).
 * `vision.describe` reads the transcript, and `vision.ocr` the spoken language, without waiting on a model the user
 * doesn't have:
 * - while the read is coming, the reader waits for it and runs once, with it;
 * - while its model is missing (its row held), the reader runs without it, and once more with it after the install;
 * - when it failed, the reader runs without it.
 * On-screen text, a searchable stage, so no longer waits on whisper.
 */
import { createAudioIndexStages, storedLanguage } from '@taalcut/audio';
import { ok, unwrap, type IndexStageDefinition, type JobRegistration } from '@taalcut/core';
import { createStageRows, MODEL_MISSING } from '@taalcut/library';
import { createVisionIndexStages } from '@taalcut/vision';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { audioJobs, SAID, type AudioWorld } from './helpers/audio-stand-ins';
import { openOldShotsLibrary, visionJobs, type OldShotsLibrary } from './helpers/old-shots-library';
import { testFfmpeg } from './helpers/test-ffmpeg';
import { wordOcr } from './helpers/vision-index-fakes';

const binaries = await testFfmpeg('optional reads');

/** The app's languages for on-screen text; the spoken one goes first once `audio.language` stored it. */
const APP = ['fr'];
/** An OCR engine that reads SALE on every frame, in the spoken language and the app's alike. */
const OCR = {
  ...wordOcr('SALE'),
  capabilities: async () => ok({ scripts: ['latin' as const], languages: ['en', ...APP] }),
};

const stages = (): IndexStageDefinition[] => [
  ...createVisionIndexStages({
    tier: 'recommended',
    ocrLanguages: () => APP,
    spokenLanguage: (view) => storedLanguage(view)?.detected.language ?? undefined,
    placement: () => 'local',
  }),
  ...createAudioIndexStages().filter((stage) => stage.stage !== 'audio.beats'),
];

/** What the readers' jobs were given, a job per entry: what is said around each shot, and the OCR languages. */
interface Seen {
  readonly said: (string | undefined)[][];
  readonly languages: string[][];
}

const describeInput = z.object({
  shots: z.array(z.object({ context: z.object({ said: z.string() }).partial().optional() })),
});
const ocrInput = z.object({ languages: z.array(z.string()) });

/** `jobs`, the describe and text-reading jobs recording what they were given. */
function recording(jobs: readonly JobRegistration[], seen: Seen): JobRegistration[] {
  const records: Record<string, (input: unknown) => number> = {
    'vision.describeShots': (input) =>
      seen.said.push(describeInput.parse(input).shots.map((shot) => shot.context?.said)),
    'vision.readShotText': (input) => seen.languages.push(ocrInput.parse(input).languages),
  };
  return jobs.map((job) => {
    const record = records[job.kind.kind];
    if (!record) return job;
    return {
      ...job,
      handler: (input, context) => {
        record(input);
        return job.handler(input, context);
      },
    };
  });
}

/** What one describe job heard, all shots together. */
const heard = (run: readonly (string | undefined)[] | undefined) => (run ?? []).filter(Boolean).join(' ');
const count = (ran: readonly string[], kind: string) => ran.filter((line) => line === kind).length;

describe.skipIf(!binaries.ok)('optional reads on the real pipeline (LRN1-CTX)', () => {
  let library: OldShotsLibrary | undefined;
  afterEach(async () => {
    await library?.close();
    library = undefined;
  });

  async function setup(audio: Partial<AudioWorld> = {}) {
    const opened = await openOldShotsLibrary(unwrap(binaries), { hasAudio: true });
    library = opened;
    const world: AudioWorld = { silent: false, language: 'ok', transcript: 'ok', ...audio };
    const seen: Seen = { said: [], languages: [] };
    const rows = createStageRows(opened.db);
    return {
      world,
      seen,
      row: (stage: string) => rows.get(opened.assetId, stage),
      index: (options?: { modelsInstalled?: boolean }) =>
        opened.index(
          stages(),
          [...recording(visionJobs({ ...opened.deps, ocr: OCR }), seen), ...audioJobs(world)],
          options,
        ),
    };
  }

  describe('vision.describe reading the transcript', () => {
    it('waits for a transcript that is coming, and runs once with what is said', async () => {
      const t = await setup();
      const ran = await t.index();
      expect(count(ran, 'audio.transcribeAssetWhisper')).toBe(1);
      expect(count(ran, 'vision.describeShots')).toBe(1);
      expect(ran.indexOf('vision.describeShots')).toBeGreaterThan(
        ran.indexOf('audio.transcribeAssetWhisper'),
      );
      expect(heard(t.seen.said[0])).toContain(SAID);
    }, 180_000);

    it('runs while the speech model is missing, and once more with what is said after the install', async () => {
      const t = await setup({ transcript: 'missing' });
      // The transcript's job finds no model: its row waits for it (held), which index() reports as a failed job.
      await expect(t.index()).rejects.toThrow(/audio\.model_missing/);
      expect(t.row('audio.transcript')).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });
      expect(t.row('vision.describe')?.state).toBe('done');
      expect(t.seen.said.map(heard)).toEqual(['']);

      t.world.transcript = 'ok';
      const ran = await t.index({ modelsInstalled: true });
      expect(count(ran, 'audio.transcribeAssetWhisper')).toBe(1);
      expect(count(ran, 'vision.describeShots')).toBe(1);
      expect(heard(t.seen.said[1])).toContain(SAID);
    }, 180_000);

    it('runs past a transcript that failed', async () => {
      const t = await setup({ transcript: 'broken' });
      await expect(t.index()).rejects.toThrow(/test\.decode_crashed/);
      expect(t.row('audio.transcript')?.state).toBe('failed');
      expect(t.row('vision.describe')?.state).toBe('done');
      expect(t.seen.said.map(heard)).toEqual(['']);
    }, 180_000);
  });

  describe('vision.ocr reading the spoken language', () => {
    it('waits for a language that is coming, and reads once with it first', async () => {
      const t = await setup();
      const ran = await t.index();
      expect(count(ran, 'vision.readShotText')).toBe(1);
      expect(t.seen.languages).toEqual([['en', ...APP]]);
    }, 180_000);

    it('reads while the language model is missing, and once more with the language after the install', async () => {
      const t = await setup({ language: 'missing' });
      await expect(t.index()).rejects.toThrow(/audio\.model_missing/);
      expect(t.row('audio.language')).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });
      // On-screen text, searchable, is read and embedded without whisper.
      expect(t.row('vision.ocr')?.state).toBe('done');
      expect(t.row('vision.embedOcr')?.state).toBe('done');
      expect(t.seen.languages).toEqual([APP]);
      // The transcript waits behind the language; descriptions don't wait for it.
      expect(t.row('audio.transcript')).toMatchObject({ state: 'waiting', reasonKey: null });
      expect(t.row('vision.describe')?.state).toBe('done');

      t.world.language = 'ok';
      const ran = await t.index({ modelsInstalled: true });
      expect(count(ran, 'audio.identifyLanguage')).toBe(1);
      expect(count(ran, 'vision.readShotText')).toBe(1);
      expect(t.seen.languages).toEqual([APP, ['en', ...APP]]);
      // The transcript came behind the language, and the shots are described once more with it.
      expect(count(ran, 'audio.transcribeAssetWhisper')).toBe(1);
      expect(count(ran, 'vision.describeShots')).toBe(1);
      expect(heard(t.seen.said.at(-1))).toContain(SAID);
    }, 180_000);

    it('reads past a language that failed', async () => {
      const t = await setup({ language: 'broken' });
      await expect(t.index()).rejects.toThrow(/test\.decode_crashed/);
      expect(t.row('audio.language')?.state).toBe('failed');
      expect(t.row('vision.ocr')?.state).toBe('done');
      expect(t.seen.languages).toEqual([APP]);
      expect(t.row('vision.describe')?.state).toBe('done');
    }, 180_000);
  });
});
