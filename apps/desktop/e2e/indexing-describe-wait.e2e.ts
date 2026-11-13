// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIX on real phone clips: a description waits for the model that describes, then arrives without a press.
 * A fresh profile gets every component of an installed profile except Qwen3.5 4B and its projector (cloned, so
 * nothing downloads), and Add folder imports the clips. Every stage settles but vision.describe, which waits for its
 * model (`library.stage.modelMissing`) instead of storing `not_yet`. The app quits, the model's files arrive the way
 * they would land after a download, and the app starts again: the descriptions come by themselves. It also records
 * the clips' speed facts and on-screen text into the evidence file, outside the repo.
 *
 * Opt-in, never in CI, macOS only: TAALCUT_IDX_CLIPS a folder of clips (copies), TAALCUT_IDX_COMPONENTS a profile's
 * `components` folder to clone from (read only), TAALCUT_IDX_OUT where the profile and the evidence go (kept). Needs
 * the test build (pnpm e2e:gate's build).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addFolder, openIndexingApp, showLibrary, type IndexingApp } from './indexing-app';
import { describeFailures, stageRows } from './indexing-support';
import { libraryRows } from './library-rows';

const CLIPS = process.env.TAALCUT_IDX_CLIPS;
const COMPONENTS = process.env.TAALCUT_IDX_COMPONENTS;
const OUT = process.env.TAALCUT_IDX_OUT;
test.skip(
  process.platform !== 'darwin' || !CLIPS || !COMPONENTS || !OUT,
  'opt-in: TAALCUT_IDX_CLIPS, TAALCUT_IDX_COMPONENTS and TAALCUT_IDX_OUT, on a Mac',
);

/** The describing model on Recommended and High Macs (index-stages.ts describerNeeds). */
const DESCRIBER = ['local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'];
const MODEL_MISSING = 'library.stage.modelMissing';
const MINUTES = 60_000;

interface Registry {
  readonly components: Record<string, { readonly dir: string }>;
}

/** Clones (APFS `cp -c`) the source profile's installed components into `userData`, the describer only if asked. */
function seedComponents(userData: string, withDescriber: boolean): string[] {
  const source = JSON.parse(readFileSync(join(COMPONENTS!, 'registry.json'), 'utf8')) as Registry;
  const root = join(userData, 'components');
  const picked = Object.entries(source.components).filter(([id]) => withDescriber || !DESCRIBER.includes(id));
  for (const [, entry] of picked) {
    const target = join(root, entry.dir);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    execFileSync('cp', ['-cR', join(COMPONENTS!, entry.dir), target]);
  }
  writeFileSync(
    join(root, 'registry.json'),
    JSON.stringify({ ...source, components: Object.fromEntries(picked) }, null, 2),
  );
  return picked.map(([id]) => id);
}

const describeRows = (userData: string) =>
  stageRows(userData).filter((row) => row.stage === 'vision.describe');

interface ShotEvidence {
  readonly fileName: string;
  readonly description: string | null;
  readonly skipped: string | null;
  readonly onScreenText: string | null;
}

function shots(userData: string): ShotEvidence[] {
  return libraryRows(
    userData,
    `SELECT a.original_filename AS fileName, s.description,
            json_extract(s.analysis, '$.descriptionSkipped') AS skipped, s.on_screen_text AS onScreenText
       FROM shots s JOIN assets a ON a.id = s.asset_id ORDER BY a.original_filename, s.index_in_asset`,
  ) as ShotEvidence[];
}

function speeds(userData: string): unknown[] {
  return libraryRows(
    userData,
    `SELECT original_filename AS fileName, speed, frame_rate_num AS rateNum, frame_rate_den AS rateDen,
            json_extract(facts, '$.speedFactor') AS factor, json_extract(facts, '$.variableFrameRate') AS vfr
       FROM assets ORDER BY original_filename`,
  );
}

/** The Library as it settles: its day heading in, no route cross-fade still running. */
async function settledLibrary(page: IndexingApp['page']): Promise<void> {
  await showLibrary(page);
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  // Finite ones only: a spinner or a bone loops for as long as its step runs.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
}

let running: IndexingApp | undefined;
test.afterAll(async () => {
  await running?.app.close().catch(() => undefined);
});

test('a description waits for its model, then arrives without a press', async () => {
  test.setTimeout(60 * MINUTES);
  const clips = readdirSync(CLIPS!).filter((name) => /\.(mp4|mov)$/i.test(name));
  expect(clips.length, `clips in ${CLIPS}`).toBeGreaterThan(0);
  const userData = join(OUT!, 'userData');
  const home = join(OUT!, 'home');
  rmSync(userData, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const evidence: Record<string, unknown> = { clips };
  const env = { HOME: home };

  // 1. Without the describing model: everything else settles, the description waits for its model.
  evidence.seededWithout = seedComponents(userData, false);
  running = await openIndexingApp(userData, CLIPS!, env);
  await addFolder(running.page);
  await expect
    .poll(
      () => {
        const rows = stageRows(userData);
        const others = rows.filter((row) => row.stage !== 'vision.describe');
        const settled =
          others.length > 0 && others.every((row) => row.state === 'done' || row.state === 'skipped');
        const waiting = describeRows(userData);
        return settled &&
          waiting.length === clips.length &&
          waiting.every((row) => row.reasonKey === MODEL_MISSING)
          ? 'waiting for the describer'
          : `${describeFailures(rows)} ${rows.filter((r) => r.state !== 'done' && r.state !== 'skipped').length} open`;
      },
      { timeout: 30 * MINUTES, intervals: [5_000] },
    )
    .toBe('waiting for the describer');
  const before = describeRows(userData);
  expect(before.every((row) => row.state === 'waiting')).toBe(true);
  expect(shots(userData).every((shot) => shot.description === null)).toBe(true);
  evidence.waiting = before.map(({ fileName, state, reasonKey }) => ({ fileName, state, reasonKey }));
  evidence.speeds = speeds(userData);
  evidence.textBefore = shots(userData).map(({ fileName, onScreenText }) => ({ fileName, onScreenText }));
  await settledLibrary(running.page);
  await running.page.screenshot({ path: join(OUT!, 'library-waiting.png') });
  await running.app.close();
  running = undefined;

  // 2. The model's files land, as a download installs them, and the app starts again: nobody presses anything.
  evidence.seededWith = seedComponents(userData, true);
  running = await openIndexingApp(userData, CLIPS!, env);
  await expect
    .poll(
      () =>
        describeRows(userData)
          .map((row) => row.state)
          .join(','),
      {
        timeout: 20 * MINUTES,
        intervals: [5_000],
      },
    )
    .toBe(clips.map(() => 'done').join(','));
  const described = shots(userData);
  evidence.described = described;
  evidence.describeRows = describeRows(userData).map(({ fileName, state, startedAt, finishedAt }) => ({
    fileName,
    state,
    startedAt,
    finishedAt,
  }));
  writeFileSync(join(OUT!, 'evidence.json'), JSON.stringify(evidence, null, 2));
  expect(described.every((shot) => shot.description !== null && shot.skipped === null)).toBe(true);
  await settledLibrary(running.page);
  await running.page.screenshot({ path: join(OUT!, 'library-described.png') });
});
