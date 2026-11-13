// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI's journey in the real app: the editor's docked chat asks for a designed graphic, which the Editor hands to
 * the Designer, and the person uses it and takes it back. The test build on recorded model sessions (stand-in
 * provider: no key, no network, no cost): the make flow's reference journey makes the video, taking the gaps
 * card's proposals, up to its one approval; then, in the editor:
 *
 * - "Add a newspaper-style headline at 0:04" in the docked chat goes to the Editor, which records a design job
 *   (graphics.design); the Designer's step after it writes the headline's composition into the project's workspace
 *   (workspace.writeFiles), checks it and proposes it at 0:04 (graphics.placeComposition). Its card in the dock names
 *   the design and when it plays, with Use it, Try again and Change…; the graphics lane shows it by its name, marked
 *   Proposed; it is stored as a proposal drawn with its composition, which the timeline keeps a copy of.
 * - Use it on the card: it is part of the video ("Added to your video."). ⌘Z makes it a proposal again.
 * - The dock's Files tab shows the design's files, read only, from the project's workspace.
 *
 * Re-record with TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=edit-design (the make flow's part replays from its own
 * cassette). The headline is a made-up test design (apps/gate-demo src/edit-design-headline.ts).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { unwrap, type GraphicItem, type Timeline } from '@taalcut/core';
import {
  EDIT_DESIGN_ASK,
  EDIT_DESIGN_AT,
  EDIT_DESIGN_ENTRY,
  EDIT_DESIGN_NAME,
  EDIT_DESIGN_SESSION,
  MAKE_FLOW_REFERENCE,
  referenceAsk,
} from '@taalcut/gate-demo';
import { createBinaryResolver } from '@taalcut/media';
import { showDetailedTimeline } from './editor-navigation';
import { libraryPath } from '../src/shared/library-path';
import { takeGapProposals } from './gap-card';
import { launchApp } from './gate-support';
import { shellAvailable } from './headless-shell';
import { makeFlowEnv, makeFlowHome, makeFlowReader, type MakeFlowHome } from './make-flow-support';
import { approvalAsks } from './review-page';
import { chatList } from './sidebar';

const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, `no FFmpeg build (${ffmpeg.ok ? '' : ffmpeg.error.code}): run tools/ffmpeg/build.sh`);
test.skip(!shellAvailable(), "no chrome-headless-shell: run e2e:provision, or render's tests once");

const FLOW_MS = Number(process.env.TAALCUT_E2E_FLOW_MS ?? 600_000);
const SHORT_TMP = process.platform === 'darwin' ? '/tmp' : tmpdir();

let app: ElectronApplication;
let page: Page;
let root: string;
let world: MakeFlowHome;
let library: ReturnType<typeof makeFlowReader>;

test.describe.configure({ mode: 'serial' });

/** The timeline the journey's draft was made from. */
function draftTimeline(userData: string): { id: string; projectId: string } {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT t.id, t.project_id FROM renders r JOIN timelines t ON t.id = r.timeline_id
          ORDER BY r.created_at DESC LIMIT 1`,
      )
      .get();
    if (!row) throw new Error('no draft');
    return { id: String(row.id), projectId: String(row.project_id) };
  } finally {
    db.close();
  }
}

/** The timeline as stored. */
function stored(userData: string, timelineId: string): Partial<Timeline> {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    const row = db.prepare('SELECT document FROM timelines WHERE id = ?').get(timelineId);
    return JSON.parse(String(row?.document ?? '{}')) as Partial<Timeline>;
  } finally {
    db.close();
  }
}

const graphicsOf = (timeline: Partial<Timeline>): GraphicItem[] =>
  (timeline.tracks ?? []).flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item): item is GraphicItem => item.type === 'graphic') : [],
  );

test.beforeAll(async () => {
  test.setTimeout(240_000);
  root = mkdtempSync(join(SHORT_TMP, 'taalcut-e2e-dsn-'));
  world = await makeFlowHome(root, unwrap(ffmpeg));
  library = makeFlowReader(world.userData);
  app = await launchApp(world.userData, makeFlowEnv(world.home));
  page = await app.firstWindow();
  await page.getByRole('link', { name: 'New chat' }).waitFor({ timeout: 60_000 });
  await chatList(page, 20_000);
});

test.afterAll(async () => {
  await app?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test('the docked chat: “a newspaper-style headline at 0:04”, designed and proposed; Use it; ⌘Z; its files', async () => {
  test.setTimeout(FLOW_MS * 2);
  // A video to edit: the reference journey up to its one approval (its draft passed QA).
  await page.getByRole('link', { name: 'New chat' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Taalcut' });
  await composer.fill(referenceAsk(world.reels[MAKE_FLOW_REFERENCE]!));
  await composer.press('Enter');
  await takeGapProposals(page.getByRole('main'), FLOW_MS);
  const ready = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Ready to export' }) })
    .last();
  await approvalAsks(ready, FLOW_MS);

  const { id, projectId } = draftTimeline(world.userData);
  await page.goto(`app://taalcut/projects/${projectId}/timeline?timeline=${id}`);
  await showDetailedTimeline(page);
  const dock = page.locator('[data-slot=editor-dock]');
  await expect(dock.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const before = graphicsOf(stored(world.userData, id)).map((item) => item.id);
  // The make's export approval waits in the dock too. A new message declines only an ask the dock shows, so send once
  // it shows: sent before, the message races it, and the run's history says the export still waits (or not).
  await expect(dock.getByText('Waiting for your answer. A new message counts as “Not now”.')).toBeVisible({
    timeout: 30_000,
  });

  // "Add a newspaper-style headline at 0:04": designed, proposed, not yet in the video.
  const box = dock.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(EDIT_DESIGN_ASK);
  await box.press('Enter');
  const card = dock.getByRole('article', { name: `Motion graphic: ${EDIT_DESIGN_NAME}` }).last();
  const proposal = card.locator('[data-slot=design-proposal]');
  await expect(proposal).toBeVisible({ timeout: FLOW_MS });
  await expect(proposal.getByText(/^Plays from 0?0:04 to /)).toBeAttached();
  for (const action of ['Use it', 'Try again', 'Change…'])
    await expect(card.getByRole('button', { name: action })).toBeVisible();
  const now = stored(world.userData, id);
  const made = graphicsOf(now).filter((item) => !before.includes(item.id));
  expect(made).toHaveLength(1);
  const graphic = made[0]!;
  expect(graphic.composition).toBeTruthy();
  expect(graphic.proposal).toMatchObject({ request: EDIT_DESIGN_ASK, design: 'designed' });
  expect(graphic.start.value / (graphic.start.rate.num / graphic.start.rate.den)).toBeCloseTo(
    EDIT_DESIGN_AT,
    1,
  );
  expect(now.graphicCompositions?.find((copy) => copy.id === graphic.composition.id)).toMatchObject({
    name: EDIT_DESIGN_NAME,
    entry: EDIT_DESIGN_ENTRY,
  });
  const block = page.locator(`[data-slot=timeline-graphic][data-graphic-id="${graphic.id}"]`);
  await expect(block).toHaveAttribute('data-proposed', '');
  await expect(block).toContainText(EDIT_DESIGN_NAME);

  // The Editor recorded the job and the Designer's step designed and placed it, in the same run.
  const run = library.runFor(EDIT_DESIGN_ASK);
  expect(run, `the ${EDIT_DESIGN_SESSION.name} run`).toBeTruthy();
  const commands = library.commandsOf(run!).map((command) => command.name);
  expect(commands).toEqual(expect.arrayContaining(['workspace.writeFiles', 'graphics.placeComposition']));
  expect(commands).not.toContain('graphics.propose');

  // Use it: part of the video. ⌘Z: a proposal again.
  await card.getByRole('button', { name: 'Use it' }).click();
  await expect(card).toContainText('Added to your video.');
  await expect(block).not.toHaveAttribute('data-proposed', '');
  await expect
    .poll(() => graphicsOf(stored(world.userData, id)).find((item) => item.id === graphic.id)?.proposal)
    .toBe(undefined);
  await page.getByRole('group', { name: 'Video preview' }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block).toHaveAttribute('data-proposed', '');
  await expect
    .poll(() => graphicsOf(stored(world.userData, id)).find((item) => item.id === graphic.id)?.proposal)
    .toMatchObject({ request: EDIT_DESIGN_ASK });

  // Its files, read only, from the project's workspace: View files opens Files in the lower work area.
  await block.click();
  await page.locator('[data-tool=more]').click();
  await page.locator('[data-slot=inspector]').getByRole('button', { name: 'View files' }).click();
  const files = page.locator('[data-slot=files-panel]');
  await expect(files).toBeVisible();
  await expect(files.getByRole('heading', { name: EDIT_DESIGN_NAME })).toBeVisible();
  const code = files.locator('[data-slot=design-code-text]');
  await expect(code).toHaveAccessibleName(/^The code of index\.html, read only/);
  await expect(code).toContainText('data-composition-id="headline"');
  await expect(files.locator('[data-slot=design-checks]')).toContainText(/passed every check/);
});
