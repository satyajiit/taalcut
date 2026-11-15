// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI's journey in the real app, as DSG2 left it: the editor's docked chat asks for a designed graphic, which the
 * Editor hands to the Designer, and the design is in the video at once. The test build on recorded model sessions
 * (stand-in provider: no key, no network, no cost): the make flow's reference journey makes the video, taking the
 * gaps card's proposals, up to its one approval; then, in the editor:
 *
 * - "Add a newspaper-style headline at 0:04" in the docked chat goes to the Editor, which records a design job
 *   (graphics.design); the Designer's step after it writes the headline's composition into the project's workspace
 *   (workspace.writeFiles), checks it, draws it over the video and places it at 0:04 (graphics.placeOptions). Its
 *   card in the dock names the design and when it plays, with nothing to "use": it is part of the video. The
 *   graphics lane shows it by its name, not marked Proposed; it is stored drawn with its composition, which the
 *   timeline keeps a copy of, as the first design of its set (the stand-in has one design, so there is nothing to
 *   choose between yet).
 * - Drawing it over the video (workspace.renderOver) shows stills of the person's video to a cloud model, so the run
 *   asks first, with the consent card in the dock, and waits. The person allows it once: the stills go, the approval
 *   is in the run's log, and no consent stands after.
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
  EDIT_DESIGN_IDEA,
  EDIT_DESIGN_NAME,
  EDIT_DESIGN_SESSION,
  MAKE_FLOW_REFERENCE,
  referenceAsk,
} from '@taalcut/gate-demo';
import { createBinaryResolver } from '@taalcut/media';
import { showDetailedTimeline } from './editor-navigation';
import { libraryPath } from '../src/shared/library-path';
import { takeGapProposals } from './gap-card';
import { launchApp, libraryReader, SEND_OFF_HEADING } from './gate-support';
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

test('the docked chat: “a newspaper-style headline at 0:04”, designed and in the video at once; its files', async () => {
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

  // "Add a newspaper-style headline at 0:04": designed and in the video at once (DSG2: no proposal to accept).
  const box = dock.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(EDIT_DESIGN_ASK);
  await box.press('Enter');
  // The Designer looks at its design over the video before placing it: stills of the person's video for a cloud
  // model, so the run asks first, here in the dock, and waits. The card says what leaves; the person allows it once.
  const consent = dock
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: SEND_OFF_HEADING }) });
  await expect(consent.getByRole('button', { name: 'Allow once' })).toBeEnabled({ timeout: FLOW_MS });
  await expect(consent).toContainText('Checking this graphic shows stills of your video with it on top to');
  await consent.getByRole('button', { name: 'Allow once' }).click();
  const card = dock.getByRole('article', { name: `Motion graphic: ${EDIT_DESIGN_NAME}` }).last();
  await expect(card).toBeVisible({ timeout: FLOW_MS });
  await expect(consent).toContainText('Sent');
  await expect(consent.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
  await expect(card.getByText(/^Starts at 0?0:04/)).toBeVisible();
  await expect(card.locator('[data-slot=design-proposal]')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Use it' })).toHaveCount(0);
  const now = stored(world.userData, id);
  const made = graphicsOf(now).filter((item) => !before.includes(item.id));
  expect(made).toHaveLength(1);
  const graphic = made[0]!;
  expect(graphic.composition).toBeTruthy();
  expect(graphic.proposal).toBeUndefined();
  // The first design of its set: one design is in use, with nothing to choose between yet.
  expect(graphic.options).toMatchObject({
    request: EDIT_DESIGN_ASK,
    designs: [{ compositionId: graphic.composition.id, idea: EDIT_DESIGN_IDEA }],
  });
  expect(graphic.start.value / (graphic.start.rate.num / graphic.start.rate.den)).toBeCloseTo(
    EDIT_DESIGN_AT,
    1,
  );
  expect(now.graphicCompositions?.find((copy) => copy.id === graphic.composition.id)).toMatchObject({
    name: EDIT_DESIGN_NAME,
    entry: EDIT_DESIGN_ENTRY,
  });
  const block = page.locator(`[data-slot=timeline-graphic][data-graphic-id="${graphic.id}"]`);
  await expect(block).not.toHaveAttribute('data-proposed', '');
  await expect(block).toContainText(EDIT_DESIGN_NAME);

  // The Editor recorded the job and the Designer's step designed and placed it, in the same run.
  const run = library.runFor(EDIT_DESIGN_ASK);
  expect(run, `the ${EDIT_DESIGN_SESSION.name} run`).toBeTruthy();
  const commands = library.commandsOf(run!).map((command) => command.name);
  expect(commands).toEqual(expect.arrayContaining(['workspace.writeFiles', 'graphics.placeOptions']));
  expect(commands).not.toContain('graphics.propose');
  expect(commands).not.toContain('graphics.placeComposition');
  // The stills were asked for once, as an upload by the agent's model, and allowed for that call alone.
  const events = library.events(run!);
  const asked = events.filter((e) => e.type === 'approval.requested' && e.payload['kind'] === 'consent');
  expect(asked.map((e) => e.payload)).toMatchObject([{ reason: 'upload', upload: { modules: ['agent'] } }]);
  const granted = events.filter((e) => e.type === 'approval.granted');
  expect(granted.map((e) => e.payload['requestId'])).toContain(asked[0]!.payload['requestId']);
  expect(libraryReader(world.userData).uploadConsents()).toBeUndefined();

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
