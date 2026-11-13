// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I5: re-indexing a library from before dependent invalidation. The reel is indexed with the stage versions
 * round IX2 shipped (no version fell in IX3-I3), and the old detector's shots, a false cut among them; the library
 * then goes back to migration 26 (the output digests' column gone, as on every library before IX3) and up to 27, then
 * to today's schema, as this build opens it. The library's real pipeline and vision's real handlers on a synthetic reel (FFmpeg, software
 * encoder, stand-in models).
 * - The first run records a digest of what each read stage stores and runs no job: the digests are the ones a
 *   library indexed by this build holds.
 * - A `VISION_CONFIG.version` rise then, or in the same upgrade, compares with what was stored: new shots re-run
 *   the stages that read them, and nothing is left keyed by the shot that is gone.
 */
import { unwrap } from '@taalcut/core';
import { LIBRARY_MIGRATIONS } from '@taalcut/library';
import { VISION_CONFIG, visionStageVersions } from '@taalcut/vision';
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
import { testFfmpeg } from './helpers/test-ffmpeg';

const binaries = await testFfmpeg('invalidation of an old library');
const CONFIG_RISE = visionStageVersions({ ...VISION_CONFIG, version: VISION_CONFIG.version + 1 });
const READERS = ['vision.readShotText', 'vision.embedTexts', 'vision.embedAsset', 'vision.describeShots'];

/** Each stage row's digest. */
const digests = (opened: OldShotsLibrary) =>
  Object.fromEntries(
    (
      opened.db.driver
        .prepare('SELECT stage, output_digest AS d FROM asset_index_stages WHERE asset_id = ? ORDER BY stage')
        .all(opened.assetId) as { stage: string; d: string | null }[]
    ).map((row) => [row.stage, row.d]),
  );

describe.skipIf(!binaries.ok)('re-indexing a library from before migration 27', () => {
  let library: OldShotsLibrary | undefined;
  afterEach(async () => {
    await library?.close();
    library = undefined;
  });

  /** Indexed by round IX2's stages and the old detector, then upgraded: every digest null. */
  async function oldLibrary() {
    const opened = await openOldShotsLibrary(unwrap(binaries));
    library = opened;
    await opened.index(visionStages(), visionJobs(opened.deps, 'old'));
    expect(opened.shots().map((shot) => shot.range.start.value)).toEqual([0, ...OLD_CUTS]);
    const recorded = digests(opened);
    unwrap(opened.db.migrateTo(26));
    unwrap(opened.db.migrateTo(27));
    // This build opens it at today's schema: the migrations after 27 run too (LIB1-LANG's view reads 35's table).
    unwrap(opened.db.migrateTo(LIBRARY_MIGRATIONS.length));
    expect(Object.values(digests(opened)).every((d) => d === null)).toBe(true);
    const gone = opened.shots().find((shot) => shot.range.start.value === 135)?.shotId;
    if (!gone) throw new Error('the old detector stored a shot at 135');
    return { opened, recorded, gone };
  }

  /** New shots re-ran their readers: every shot-keyed vector and search row is a current shot's. */
  async function reranOnNewShots(opened: OldShotsLibrary, gone: string) {
    const ran = await opened.index(visionStages(CONFIG_RISE), visionJobs(opened.deps));
    for (const kind of ['vision.detectShots', 'vision.analyzeShots', ...READERS]) expect(ran).toContain(kind);
    expect(opened.shots().map((shot) => shot.range.start.value)).toEqual([0, ...CUTS]);
    const ids = opened
      .shots()
      .map((shot) => shot.shotId)
      .sort();
    for (const kind of ['frame', 'ocr', 'description'])
      expect([...shotIdsIn(opened.vectors(kind))].sort(), kind).toEqual(ids);
    expect(opened.searchRows()).not.toContain(gone);
  }

  it('records the digests on the first run and re-runs nothing; a rise after that follows new shots', async () => {
    const { opened, recorded, gone } = await oldLibrary();
    expect(await opened.index(visionStages(), visionJobs(opened.deps, 'old'))).toEqual([]);
    expect(digests(opened)).toEqual(recorded);
    for (const stage of ['media.normalise', 'vision.shots', 'vision.analyse', 'vision.ocr'])
      expect(recorded[stage], stage).toMatch(/^[0-9a-f]{64}$/);
    await reranOnNewShots(opened, gone);
  }, 180_000);

  it('a rise in the same upgrade compares with what the old detector stored', async () => {
    const { opened, gone } = await oldLibrary();
    await reranOnNewShots(opened, gone);
  }, 180_000);
});
