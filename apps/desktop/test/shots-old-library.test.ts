// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C5: a library indexed by the shot detector before TransNetV2 (main's stage versions, and the shots it
 * stored, a false cut among them) opened by this build. The library's real pipeline resets every shot-keyed
 * stage, because each one's version derives from the detector's, and vision's real handlers run them again on
 * a synthetic reel (FFmpeg, software encoder) with stand-in models: afterwards no shot row, search row or
 * vector is keyed by the shot that is gone, shots whose start held keep their ids, and every shot has its
 * analysis, text, frame and description again. IX2-F3: the same on a Mac with no OCR engine in this build
 * (helper not built, a platform without one) leaves no on-screen-text vector of the gone shot.
 */
import { unwrap, type ShotId } from '@taalcut/core';
import { createStageRows } from '@taalcut/library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CUTS,
  MAIN_VERSIONS,
  OLD_CUTS,
  openOldShotsLibrary,
  shotIdsIn,
  visionJobs,
  visionStages,
  type OldShotsLibrary,
} from './helpers/old-shots-library';
import { testFfmpeg } from './helpers/test-ffmpeg';

const binaries = await testFfmpeg('shots of an old library');
const VISION_KINDS = [
  'vision.detectShots',
  'vision.analyzeShots',
  'vision.readShotText',
  'vision.embedTexts',
  'vision.embedAsset',
  'vision.describeShots',
  'vision.indexContactSheet',
];

describe.skipIf(!binaries.ok)('a library indexed by the old shot detector', () => {
  let library: OldShotsLibrary | undefined;
  afterEach(async () => {
    await library?.close();
    library = undefined;
  });

  /** Indexed as main did, with on-screen text read: the shot at 135, which TransNetV2 won't find. */
  async function indexedByMain(): Promise<{ library: OldShotsLibrary; gone: ShotId }> {
    const opened = await openOldShotsLibrary(unwrap(binaries));
    library = opened;
    // Contact sheets were added after this library was indexed.
    const oldStages = visionStages(MAIN_VERSIONS).filter((stage) => stage.stage in MAIN_VERSIONS);
    await opened.index(oldStages, visionJobs(opened.deps, 'old'));
    const before = opened.shots();
    expect(before.map((shot) => shot.range.start.value)).toEqual([0, ...OLD_CUTS]);
    const gone = before.find((shot) => shot.range.start.value === 135)!.shotId;
    for (const kind of ['frame', 'ocr', 'description'])
      expect(shotIdsIn(opened.vectors(kind)).has(gone)).toBe(true);
    return { library: opened, gone };
  }

  it('re-runs every shot-keyed stage and keeps nothing keyed by a shot that is gone', async () => {
    const { library: opened, gone } = await indexedByMain();
    const before = opened.shots();

    // This build: the same library, the current stage versions, TransNetV2's place taken by a stand-in.
    const current = visionStages();
    const rows = createStageRows(opened.db);
    for (const stage of current)
      expect(stage.version).toBeGreaterThan(rows.get(opened.assetId, stage.stage)?.version ?? 0);
    const ran = await opened.index(current, visionJobs(opened.deps));
    for (const kind of VISION_KINDS) expect(ran).toContain(kind);
    for (const stage of current) {
      const row = rows.get(opened.assetId, stage.stage);
      expect(row, `${stage.stage}: ${JSON.stringify(row)}`).toMatchObject({
        state: 'done',
        version: stage.version,
      });
    }
    expect(rows.get(opened.assetId, 'vision.shots')?.output).toMatchObject({
      cuts: CUTS.map((frame) => ({ frame, method: 'model', kind: 'cut' })),
    });

    const after = opened.shots();
    expect(after.map((shot) => shot.range.start.value)).toEqual([0, ...CUTS]);
    // Shots whose start held keep their ids (105's end moved: its analysis was cleared and made again).
    const idAt = (shots: typeof before, frame: number) =>
      shots.find((s) => s.range.start.value === frame)?.shotId;
    for (const frame of [0, ...CUTS]) expect(idAt(after, frame)).toBe(idAt(before, frame));
    const ids = new Set<string>(after.map((shot) => shot.shotId));
    for (const shot of after) expect(shot.analysis?.onScreenText.map((t) => t.text)).toEqual(['SALE']);
    for (const kind of ['frame', 'ocr', 'description']) {
      const keyed = shotIdsIn(opened.vectors(kind));
      expect([...keyed].sort(), kind).toEqual([...ids].sort());
    }
    expect(opened.searchRows()).not.toContain(gone);
    expect(opened.searchRows().sort()).toEqual([...ids].sort());
    const sheet = rows.get(opened.assetId, 'vision.contactSheet')?.output;
    expect(sheet).toMatchObject({
      contactSheet: { file: { mimeType: 'image/jpeg', bytes: expect.any(Number) } },
    });
    expect(JSON.stringify(sheet)).not.toContain(gone);
  }, 180_000);

  it('with no OCR engine in this build, keeps no on-screen-text vector of a gone shot', async () => {
    const { library: opened, gone } = await indexedByMain();
    const mainShots = new Set(opened.shots().map((shot) => shot.shotId));
    const { ocr: _ocr, ...noEngine } = opened.deps;
    const ran = await opened.index(visionStages(), visionJobs(noEngine));
    expect(ran).toContain('vision.readShotText');
    const after = opened.shots();
    expect(after.map((shot) => shot.range.start.value)).toEqual([0, ...CUTS]);
    // A shot main's run had keeps the text its engine read there (the frames are the same); no other shot has any.
    const withText = after.filter((shot) => (shot.analysis?.onScreenText ?? []).length > 0);
    for (const shot of withText) expect(mainShots.has(shot.shotId) && shot.shotId !== gone).toBe(true);
    // The read keeps the text vectors of shots still here and drops the gone shot's (IX2-F3, F12); vision.embedOcr
    // embeds the kept text again, so the vectors left are exactly those of the shots that still show text.
    expect([...shotIdsIn(opened.vectors('ocr'))].sort()).toEqual(withText.map((shot) => shot.shotId).sort());
    const ids = [...new Set<string>(after.map((shot) => shot.shotId))].sort();
    for (const kind of ['frame', 'description']) {
      expect(shotIdsIn(opened.vectors(kind)).has(gone), kind).toBe(false);
      expect([...shotIdsIn(opened.vectors(kind))].sort(), kind).toEqual(ids);
    }
  }, 180_000);
});
