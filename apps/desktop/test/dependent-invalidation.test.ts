// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I3 with the library's real pipeline and vision's real handlers on a synthetic reel (FFmpeg, software encoder,
 * stand-in models): what a stage stores when it runs again decides which stages run after it, not version rises.
 * - A `VISION_CONFIG.version` rise that changes the shots re-runs `vision.embed` and `vision.describe` (and the text
 *   stages), at their own versions; one that leaves the shots as they were re-runs neither, and every description
 *   stays.
 * - On-screen text gone from some shots (an `ocr.version` rise, a read that finds less): `vision.embedOcr` runs
 *   again and their vectors go; gone from all, it skips and every text vector goes. `vision.describe` runs again
 *   too: since LRN1-CTX each shot is described with the text around it.
 * - A clip that turns silent: `audio.transcript` and `vision.embedText` skip, and the transcript vectors go;
 *   `vision.describe`, which reads the transcript, runs again.
 */
import { unwrap, type IndexStageDefinition } from '@taalcut/core';
import { createAudioIndexStages } from '@taalcut/audio';
import { createStageRows } from '@taalcut/library';
import {
  createVisionIndexStages,
  VISION_CONFIG,
  visionStageVersions,
  type StageVersionConfig,
} from '@taalcut/vision';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CUTS,
  OLD_CUTS,
  openOldShotsLibrary,
  shotIdsIn,
  visionJobs,
  visionStages,
  type OldShotsLibrary,
} from './helpers/old-shots-library';
import { audioJobs, type AudioWorld } from './helpers/audio-stand-ins';
import { wordOcr } from './helpers/vision-index-fakes';
import { testFfmpeg } from './helpers/test-ffmpeg';

const binaries = await testFfmpeg('dependent invalidation');
const NOW = visionStageVersions(VISION_CONFIG);
const rise = (over: Partial<StageVersionConfig>) => visionStageVersions({ ...VISION_CONFIG, ...over });
const CONFIG_RISE = rise({ version: VISION_CONFIG.version + 1 });
/** The stages that read the shots, by the job kind each runs. */
const READERS = ['vision.readShotText', 'vision.embedTexts', 'vision.embedAsset', 'vision.describeShots'];
const SHOT_KEYED = ['frame', 'ocr', 'description'];

describe.skipIf(!binaries.ok)('dependent invalidation with vision’s handlers', () => {
  let library: OldShotsLibrary | undefined;
  afterEach(async () => {
    await library?.close();
    library = undefined;
  });

  async function open(hasAudio = false): Promise<OldShotsLibrary> {
    library = await openOldShotsLibrary(unwrap(binaries), { hasAudio });
    return library;
  }
  const starts = (opened: OldShotsLibrary) => opened.shots().map((shot) => shot.range.start.value);
  const keyed = (opened: OldShotsLibrary, kind: string) => [...shotIdsIn(opened.vectors(kind))].sort();

  it('a VISION_CONFIG.version rise that changes the shots re-runs vision.embed and vision.describe', async () => {
    const opened = await open();
    await opened.index(visionStages(), visionJobs(opened.deps, 'old'));
    expect(starts(opened)).toEqual([0, ...OLD_CUTS]);
    const gone = opened.shots().find((shot) => shot.range.start.value === 135)?.shotId;
    expect(gone).toBeDefined();

    const ran = await opened.index(visionStages(CONFIG_RISE), visionJobs(opened.deps));
    for (const kind of ['vision.detectShots', 'vision.analyzeShots', ...READERS]) expect(ran).toContain(kind);
    // They ran because what they read changed: their versions are the ones they had.
    const rows = createStageRows(opened.db);
    for (const stage of ['vision.embed', 'vision.describe', 'vision.ocr', 'vision.embedOcr'] as const) {
      expect(CONFIG_RISE[stage]).toBe(NOW[stage]);
      expect(rows.get(opened.assetId, stage), stage).toMatchObject({ state: 'done', version: NOW[stage] });
    }
    expect(starts(opened)).toEqual([0, ...CUTS]);
    const ids = opened
      .shots()
      .map((shot) => shot.shotId)
      .sort();
    for (const kind of SHOT_KEYED) expect(keyed(opened, kind), kind).toEqual(ids);
    expect(opened.searchRows()).not.toContain(gone);
    for (const shot of opened.shots())
      expect(shot.analysis?.description?.text).toBe('A flat field of colour.');
  }, 180_000);

  it('a rise that leaves the shots as they were re-runs neither, and keeps every vector and description', async () => {
    const opened = await open();
    await opened.index(visionStages(), visionJobs(opened.deps));
    const shots = opened.shots();
    const vectors = SHOT_KEYED.map((kind) => opened.vectors(kind).sort());

    const ran = await opened.index(visionStages(CONFIG_RISE), visionJobs(opened.deps));
    expect(ran).toContain('vision.detectShots');
    expect(ran).toContain('vision.analyzeShots');
    for (const kind of READERS) expect(ran).not.toContain(kind);
    expect(opened.shots().map((shot) => [shot.shotId, shot.range.start.value])).toEqual(
      shots.map((shot) => [shot.shotId, shot.range.start.value]),
    );
    expect(SHOT_KEYED.map((kind) => opened.vectors(kind).sort())).toEqual(vectors);
    // The analysis ran again; the descriptions of shots whose range and best frame held stay (withStoredDescriptions).
    for (const shot of opened.shots())
      expect(shot.analysis?.description?.text).toBe('A flat field of colour.');

    // And again, unchanged: nothing runs at all.
    expect(await opened.index(visionStages(CONFIG_RISE), visionJobs(opened.deps))).toEqual([]);
  }, 180_000);

  it('text gone from some shots takes their vectors; gone from all, every text vector', async () => {
    const opened = await open();
    await opened.index(visionStages(), visionJobs(opened.deps));
    expect(keyed(opened, 'ocr')).toHaveLength(CUTS.length + 1);

    // A better read finds SALE only on the shots before frame 105.
    const fewer = { ...opened.deps, ocr: wordOcr('SALE', 105) };
    const ran = await opened.index(
      visionStages(rise({ ocr: { version: VISION_CONFIG.ocr.version + 1 } })),
      visionJobs(fewer),
    );
    expect(ran).toContain('vision.readShotText');
    expect(ran).toContain('vision.embedTexts');
    // The text around the shots changed, and descriptions read it (LRN1-CTX).
    expect(ran).toContain('vision.describeShots');
    for (const kind of ['vision.detectShots', 'vision.analyzeShots', 'vision.embedAsset'])
      expect(ran).not.toContain(kind);
    const withText = opened.shots().filter((shot) => (shot.analysis?.onScreenText ?? []).length > 0);
    expect(withText.map((shot) => shot.range.start.value)).toEqual([0, 60]);
    expect(keyed(opened, 'ocr')).toEqual(withText.map((shot) => shot.shotId).sort());

    const none = { ...opened.deps, ocr: wordOcr('SALE', 0) };
    await opened.index(
      visionStages(rise({ ocr: { version: VISION_CONFIG.ocr.version + 2 } })),
      visionJobs(none),
    );
    expect(opened.vectors('ocr')).toEqual([]);
    expect(createStageRows(opened.db).get(opened.assetId, 'vision.embedOcr')).toMatchObject({
      state: 'skipped',
    });
  }, 180_000);

  it('a clip that turns silent loses its transcript and the transcript’s vectors', async () => {
    const opened = await open(true);
    const world: AudioWorld = { silent: false, language: 'ok', transcript: 'ok' };
    const stages: IndexStageDefinition[] = [
      ...createVisionIndexStages({
        tier: 'recommended',
        ocrLanguages: () => ['en'],
        placement: () => 'local',
      }),
      ...createAudioIndexStages().filter((stage) => stage.stage !== 'audio.beats'),
    ];
    const index = (list: IndexStageDefinition[]) =>
      opened.index(list, [...visionJobs(opened.deps), ...audioJobs(world)]);
    const ran = await index(stages);
    expect(ran).toContain('audio.transcribeAssetWhisper');
    expect(opened.vectors('transcript')).toEqual([`transcript:${opened.assetId}:0`]);
    const ocr = opened.vectors('ocr').sort();

    // A better measure finds no speech: audio.language's version rises, nothing else's.
    world.silent = true;
    const again = await index(
      stages.map((stage) =>
        stage.stage === 'audio.language' ? { ...stage, version: stage.version + 1 } : stage,
      ),
    );
    expect(again).toContain('audio.identifyLanguage');
    expect(again).not.toContain('audio.transcribeAssetWhisper');
    expect(again).not.toContain('vision.embedTexts');
    // The transcript went, and descriptions read it (LRN1-CTX).
    expect(again).toContain('vision.describeShots');
    const rows = createStageRows(opened.db);
    for (const stage of ['audio.transcript', 'vision.embedText'])
      expect(rows.get(opened.assetId, stage), stage).toMatchObject({
        state: 'skipped',
        reasonKey: 'indexing.skip.silent',
      });
    expect(opened.vectors('transcript')).toEqual([]);
    // The on-screen text read again (it reads the language) found the same: its vectors stay.
    expect(opened.vectors('ocr').sort()).toEqual(ocr);
  }, 180_000);
});
