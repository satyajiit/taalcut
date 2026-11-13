// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX's journey in the real app: the editor's docked chat edits what you selected, as one step you can take
 * back. The test build on recorded model sessions (stand-in provider: no key, no network, no cost): the make
 * flow's reference journey (make-flow.e2e.ts) makes the video, taking the gaps card's proposals, up to its one
 * approval; then, in the editor:
 *
 * - the dock is open on Chat, with the project's conversation;
 * - the last clip is selected, and the docked composer shows it as a chip;
 * - "Make this clip shorter" goes with the editor's context to the agent, which sends it straight to the Editor
 *   skill (the edit-chat session's stand-in takes a beat off the clip's end with timeline.trimClip);
 * - the run ends with the changes card, its row "Clip N: a → b", and the turn's commands share its group;
 * - Undo AI changes takes the turn back: the clip is as long as before, and the card says Undone.
 *
 * Re-record the docked turn with TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=edit-chat (the make flow's part replays
 * from its own cassette).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { unwrap } from '@taalcut/core';
import { EDIT_CHAT_ASK, EDIT_CHAT_SESSION, MAKE_FLOW_REFERENCE, referenceAsk } from '@taalcut/gate-demo';
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

/** The groups of the commands a run dispatched, from the audit log. */
function groupsOf(userData: string, runId: string): (string | null)[] {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    return db
      .prepare('SELECT group_id FROM commands WHERE actor = ? ORDER BY seq')
      .all(`agent:${runId}`)
      .map((row) => (row.group_id === null ? null : String(row.group_id)));
  } finally {
    db.close();
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  root = mkdtempSync(join(SHORT_TMP, 'taalcut-e2e-edit-'));
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

test('the docked chat: select a clip, “make this clip shorter”, the changes card, undo', async () => {
  test.setTimeout(FLOW_MS * 2);
  // A video to edit: the reference journey up to its one approval (its draft passed QA).
  await page.getByRole('link', { name: 'New chat' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Taalcut' });
  await composer.fill(referenceAsk(world.reels[MAKE_FLOW_REFERENCE]!));
  await composer.press('Enter');
  // FIX-ASK: the reel's cast leaves two of five clips unsure, so the run asks on the gapFix card before render; take
  // Taalcut's proposals, as every make-flow journey does.
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
  // The make's export approval waits in the dock too. A new message declines only an ask the dock shows, so send once
  // it shows: sent before, the message races it, and the run's history says the export still waits (or not).
  await expect(dock.getByText('Waiting for your answer. A new message counts as “Not now”.')).toBeVisible({
    timeout: 30_000,
  });
  // The editor's own clips: the docked chat's cards have clip lists of their own.
  const clips = page.locator('[data-slot=timeline-clip]');
  const last = clips.last();
  await last.click();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  const number = (await clips.count()).toString();
  const tray = dock.locator('[data-slot=composer] [data-slot=selection-chip][data-kind=clip]');
  await expect(tray).toContainText(`Clip ${number}`);
  const width = () => last.evaluate((el) => el.getBoundingClientRect().width);
  const before = await width();

  const box = dock.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(EDIT_CHAT_ASK);
  await box.press('Enter');
  const card = dock.locator('[data-card-type=editChanges]');
  await expect(card).toBeVisible({ timeout: FLOW_MS });
  await expect(card.getByRole('button', { name: new RegExp(`^Clip ${number}: .+ → .+`) })).toBeVisible();
  await expect.poll(width).toBeLessThan(before - 2);

  // The docked run went straight to the Editor, with the editor's context, and its commands are one turn.
  const runId = library.runFor(EDIT_CHAT_ASK);
  expect(runId, `the ${EDIT_CHAT_SESSION.name} run`).toBeTruthy();
  const events = library.events(runId!);
  const started = events.find((event) => event.type === 'run.started')?.payload;
  expect(started).toMatchObject({ editor: { route: 'edit', context: { timelineId: id } } });
  const plan = events.find((event) => event.type === 'plan.created')?.payload as {
    steps?: { skill?: string }[];
  };
  expect(plan?.steps?.map((step) => step.skill)).toEqual(['timeline.editor']);
  expect(library.commandsOf(runId!).map((command) => command.name)).toContain('timeline.trimClip');
  expect(new Set(groupsOf(world.userData, runId!))).toEqual(new Set([`turn:${runId}`]));

  await page.getByRole('button', { name: 'Undo AI changes', exact: true }).click();
  await expect(card).toContainText('Undone');
  await expect.poll(width).toBeGreaterThan(before - 1);
});
