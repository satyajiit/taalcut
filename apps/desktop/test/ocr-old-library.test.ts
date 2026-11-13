// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F12: a library whose on-screen text an engine read (every shot of a synthetic reel shows SALE), opened by a
 * build that has no OCR engine (helper not built, a platform without one) after an `ocr.version` rise: `vision.ocr`
 * runs and reads nothing. Or after a `VISION_CONFIG.version` rise, which re-runs shot detection and the analysis:
 * they store the same shots and best frames, so `vision.ocr`, which reads them, doesn't run at all (dependent
 * invalidation, IX3-I3). Either way `vision.embedOcr` doesn't run (what `vision.ocr` stores didn't change), every
 * shot keeps its text (PO decision F3) and its on-screen-text vectors, and a search for the text finds the shots
 * through them as it did before. The library's real pipeline and vision's real handlers, FFmpeg with a software
 * encoder, stand-in models.
 */
import { ok, unwrap } from '@taalcut/core';
import { createLibrarySearch } from '@taalcut/library';
import {
  createVisionJobs,
  VISION_CONFIG,
  visionStageVersions,
  type StageVersionConfig,
} from '@taalcut/vision';
import { pictureChangeModel } from '@taalcut/vision/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { CUTS, openOldShotsLibrary, visionStages, type OldShotsLibrary } from './helpers/old-shots-library';
import { testFfmpeg } from './helpers/test-ffmpeg';

const binaries = await testFfmpeg('OCR of an old library');
const detector = async () => ok(pictureChangeModel());

/** Each rise as a config, and the job kinds it runs: only `vision.ocr`'s own rise reads the text again. */
const RISES: { rise: string; config: StageVersionConfig; ran: string[]; notRun: string[] }[] = [
  {
    rise: 'ocr.version',
    config: { ...VISION_CONFIG, ocr: { version: VISION_CONFIG.ocr.version + 1 } },
    ran: ['vision.readShotText'],
    notRun: ['vision.embedTexts'],
  },
  {
    rise: 'VISION_CONFIG.version',
    config: { ...VISION_CONFIG, version: VISION_CONFIG.version + 1 },
    ran: ['vision.detectShots', 'vision.analyzeShots'],
    notRun: ['vision.readShotText', 'vision.embedTexts'],
  },
];

describe.skipIf(!binaries.ok)('a library re-read with no OCR engine after vision.ocr’s version rose', () => {
  let library: OldShotsLibrary | undefined;
  afterEach(async () => {
    await library?.close();
    library = undefined;
  });

  /** The shots a search for SALE finds through their on-screen-text vectors. */
  async function foundByText(opened: OldShotsLibrary): Promise<string[]> {
    const { embedder, index } = opened.deps;
    if (!embedder || !index) throw new Error('the library has an embedder and an index');
    const found = unwrap(
      await createLibrarySearch({ db: opened.db, vectors: index, embedder }).search('SALE', undefined, 20),
    );
    expect(found.degraded).toBeUndefined();
    return found.hits
      .filter((hit) => hit.matchedBy.includes('onScreenText'))
      .map((hit) => hit.shot.id)
      .sort();
  }

  /** Indexed by this build with an engine: every shot reads SALE and has its on-screen-text vector. */
  async function indexedWithText() {
    const opened = await openOldShotsLibrary(unwrap(binaries));
    library = opened;
    await opened.index(visionStages(), createVisionJobs({ ...opened.deps, boundaryModel: detector }));
    const shots = opened.shots();
    expect(shots.map((shot) => shot.range.start.value)).toEqual([0, ...CUTS]);
    for (const shot of shots) expect(shot.analysis?.onScreenText.map((t) => t.text)).toEqual(['SALE']);
    const ocr = opened.vectors('ocr').sort();
    expect(ocr).toEqual(shots.map((shot) => `ocr:${shot.shotId}:0`).sort());
    const byText = await foundByText(opened);
    expect(byText.length).toBeGreaterThan(0);
    return { opened, shots, ocr, byText };
  }

  for (const { rise, config, ran: runs, notRun } of RISES) {
    it(`keeps every kept shot’s on-screen-text vectors and finds it by its text (${rise} rose)`, async () => {
      const { opened, shots, ocr, byText } = await indexedWithText();
      const { ocr: _engine, ...noEngine } = opened.deps;
      const ran = await opened.index(
        visionStages(visionStageVersions(config)),
        createVisionJobs({ ...noEngine, boundaryModel: detector }),
      );
      for (const kind of runs) expect(ran).toContain(kind);
      for (const kind of notRun) expect(ran).not.toContain(kind);

      const after = opened.shots();
      expect(after.map((shot) => shot.shotId)).toEqual(shots.map((shot) => shot.shotId));
      for (const shot of after) expect(shot.analysis?.onScreenText.map((t) => t.text)).toEqual(['SALE']);
      expect(opened.vectors('ocr').sort()).toEqual(ocr);
      // The search finds the same shots through their on-screen text as before the re-read.
      expect(await foundByText(opened)).toEqual(byText);
    }, 180_000);
  }
});
