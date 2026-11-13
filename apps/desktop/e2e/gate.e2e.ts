// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-I1, gate criterion 1 automated: the gate demo in the real app, the way
 * the product owner watches it. The test build (TAALCUT_BUILD_FLAVOUR=test,
 * with the real renderer) starts with a temporary home holding
 * Desktop/Trip/beach.mov (made with the FFmpeg build) and with
 * TAALCUT_TEST_RECORDED_MODELS, so the agent process's models replay the gate
 * demo's recorded session (apps/gate-demo) through real @taalcut/models
 * clients. Everything else is the app: main, the agent process with the chat
 * service and tools, the jobs process running media jobs, the library.
 *
 * In the window: type the ask into the chat, answer the upload's consent card
 * with Always allow, read the answer. The agent's model names the chat. A
 * follow-up in the same conversation uploads another frame without asking,
 * and so does one after the app restarts (back to the chat by its name). Once the consent is revoked (appContract.consents, called from
 * the page: Settings has no control for it yet), the next upload asks again
 * and Allow once answers it. ⌘Z in the composer undoes typing; with focus
 * outside it, ⌘Z removes the folder the agent added. Then the first run in the trace viewer:
 * every span's time, and every model and tool span's tokens and cost, on
 * screen. The library database backs it up: one CloudCall row per model call,
 * the media jobs done in the jobs process, the consent in Settings.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { unwrap, type RunId } from '@taalcut/core';
import {
  FRAME_DESCRIPTION,
  GATE_AGENT,
  GATE_DEMO_ASK,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_FOLLOW_UPS,
  GATE_DEMO_TITLE,
  type FollowUp,
} from '@taalcut/gate-demo';
import { createBinaryResolver } from '@taalcut/media';
import {
  failedJobs,
  installAppClient,
  launchApp,
  libraryReader,
  makeVideo,
  SEND_OFF_HEADING,
  StartupTimeline,
  unsettledJobs,
} from './gate-support';
import { chatList } from './sidebar';

// The app's jobs process finds FFmpeg the same way (tools/ffmpeg/dist, or TAALCUT_FFMPEG_DIR).
const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, `no FFmpeg build (${ffmpeg.ok ? '' : ffmpeg.error.code}): run tools/ffmpeg/build.sh`);

/** Tools the recorded session runs, in order (meta tools such as updatePlan don't show as tool runs). */
const TOOLS = ['library.addSource', 'library.listFiles', 'media.probe', 'vision.describeFrame'];
/** Each follow-up finds the folder and looks at its frame. */
const FOLLOW_UP_TOOLS = ['library.listSources', 'vision.describeFrame'];

let app: ElectronApplication;
let page: Page;
let root: string;
let home: string;
let trip: string;
let userData: string;
let library: ReturnType<typeof libraryReader>;
let runId: RunId;
let chatUrl: string;

test.describe.configure({ mode: 'serial' });

/** Launches the test build on this test's home and userData, timing each start-up step. */
async function launch(): Promise<void> {
  const start = new StartupTimeline();
  app = await start.step('app launch', 45_000, () =>
    launchApp(userData, { HOME: home, TAALCUT_TEST_RECORDED_MODELS: GATE_DEMO_FIXTURES }),
  );
  start.listen(app);
  page = await start.step('first window', 30_000, () => app.firstWindow());
  await start.step('renderer ready', 15_000, () => page.waitForLoadState('domcontentloaded'));
  const placeholder = await page.evaluate(() => document.querySelector('script[src$="probe.mjs"]') !== null);
  if (placeholder) throw new Error('out/ has the placeholder renderer: build with `pnpm e2e:gate`.');
  // The shell renders once the page has its port to main and the services on it.
  await start.step('main connection ready', 20_000, () =>
    page.getByRole('link', { name: 'New chat' }).waitFor(),
  );
  // The chat list comes from the agent process: it is up and serving.
  await start.step('agent ready', 20_000, () => chatList(page, 20_000));
}

const transcript = () => page.getByRole('main');
const composer = () => page.getByRole('textbox', { name: 'Message Taalcut' });
/** Message roles exclude the operation and cost cards that also render as articles. */
const userMessages = () => transcript().locator('[data-slot=chat-message][data-role=user]');
const lastAnswer = () => transcript().locator('[data-slot=chat-message][data-role=agent]').last();
/** Decision cards, by their titles. */
const card = (title: string) =>
  transcript()
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
const consentCards = () => card(SEND_OFF_HEADING);
/**
 * The line under a run that waits for your answer. Since UX round 1 a card in the transcript has no
 * "Waiting for you" chip: this one line says it, and the waiting card offers its answers.
 */
const waitingLine = () => transcript().getByText('Waiting for your answer.');
const approvalCards = () => card('Can Taalcut go ahead?');
/** Check the persistent operation state after opening Activity, not transient live announcements. */
async function expectToolsDone(tools: readonly string[]): Promise<void> {
  const closed = transcript().locator('[data-slot="run-activity-toggle"][aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
  const done = transcript().locator('[data-slot="tool-group"][data-status="succeeded"]');
  await expect(done, failedJobs(library.jobs())).toHaveCount(tools.length);
  for (const tool of new Set(tools)) {
    const groups = done.and(transcript().locator(`[data-tool="${tool}"]`));
    await expect(groups).toHaveCount(tools.filter((name) => name === tool).length);
    for (const group of await groups.all()) {
      await expect(group).toBeVisible();
      await expect(group).toHaveAttribute('data-count', '1');
    }
  }
}

/** Types a follow-up into the chat; its frame goes up without a consent card, on the standing consent. */
async function followUp(ask: FollowUp, consentCardsBefore: number): Promise<void> {
  await composer().fill(ask.ask);
  await composer().press('Enter');
  await expect(userMessages().last()).toContainText(ask.ask);
  await expect(lastAnswer(), failedJobs(library.jobs())).toContainText(ask.answer, { timeout: 30_000 });
  await expect(lastAnswer()).not.toHaveAttribute('aria-busy', 'true');
  await expect(consentCards()).toHaveCount(consentCardsBefore);
  await expect(approvalCards()).toHaveCount(0);
  const run = library.runFor(ask.ask) as RunId;
  expect(library.cloudCalls(run).filter((call) => call.module === 'vision')).toHaveLength(1);
}

test.beforeAll(async () => {
  test.setTimeout(150_000);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-e2e-gate-')));
  home = join(root, 'home');
  trip = join(home, 'Desktop', 'Trip');
  userData = join(root, 'user-data');
  mkdirSync(trip, { recursive: true });
  mkdirSync(userData);
  library = libraryReader(userData);
  await makeVideo(unwrap(ffmpeg), join(trip, 'beach.mov'));
  writeFileSync(join(trip, 'notes.txt'), 'not a video');
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

test('the ask, typed into the chat: folder added, video probed, upload allowed always, frame described', async () => {
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
  chatUrl = page.url();
  await composer().fill(GATE_DEMO_ASK);
  await composer().press('Enter');
  await expect(userMessages()).toHaveCount(1);
  await expect(userMessages()).toContainText(GATE_DEMO_ASK);

  // The frame upload waits for the user, whatever the autonomy level: what leaves the Mac, and to whom.
  const consent = consentCards();
  await expect(consent, failedJobs(library.jobs())).toBeVisible({ timeout: 30_000 });
  await expect(consent.getByRole('button', { name: 'Always allow' })).toBeEnabled();
  await expect(waitingLine()).toBeVisible();
  // One file: the card's sentence names it and who gets it (a list only for several, since UX round 1).
  await expect(consent).toContainText('Describing beach.mov sends one frame of it to Google and OpenAI.');
  await expect(approvalCards()).toHaveCount(0);
  // Before it: the folder added, the files listed, the first video probed.
  await expectToolsDone(TOOLS.slice(0, -1));
  await consent.getByRole('button', { name: 'Always allow' }).click();

  // The answer, with what the vision model saw; the card now says the frame was sent.
  await expect(lastAnswer(), failedJobs(library.jobs())).toContainText(FRAME_DESCRIPTION, {
    timeout: 30_000,
  });
  await expect(lastAnswer()).not.toHaveAttribute('aria-busy', 'true');
  await expect(consent).toContainText('Sent');
  await expect(consent.getByRole('button', { name: 'Always allow' })).toHaveCount(0);
  await expect(waitingLine()).toHaveCount(0);
  // Activity retains the model's actual reasoning, beside its successful operations.
  await expect(
    transcript()
      .locator('[data-activity-note="reasoning"]')
      .getByText('Three things to do: add the folder, find the first video in it, then look at that video.'),
  ).toBeVisible();
  await expectToolsDone(TOOLS);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

  runId = library.runFor(GATE_DEMO_ASK) as RunId;
  expect(runId).toBeTruthy();
  expect(library.uploadConsents()).toMatchObject({ vision: { module: 'vision' } });
});

test('another upload in the same conversation goes ahead without asking', async () => {
  await followUp(GATE_DEMO_FOLLOW_UPS[0], 1);
  await expectToolsDone([...TOOLS, ...FOLLOW_UP_TOOLS]);
});

test('Always allow outlives a restart: after relaunching, the next upload does not ask either', async () => {
  test.setTimeout(150_000);
  await app.close();
  await launch();
  // Back to the conversation from the chat list, by the name the model gave it after the first exchange:
  // its history, with the one consent card, already answered. (The link also reads the time.)
  await (await chatList(page)).getByRole('link', { name: GATE_DEMO_TITLE }).click();
  await expect(page).toHaveURL(chatUrl);
  await expect(consentCards()).toHaveCount(1);
  await expect(consentCards()).toContainText('Sent');
  await followUp(GATE_DEMO_FOLLOW_UPS[1], 1);
});

test('a revoked Always allow asks again: the next upload shows the consent card', async () => {
  // Settings has no control for it yet (the Hallmark redesign builds one): the app contract, as the renderer calls it.
  await installAppClient(page);
  const consents = await page.evaluate(async () => {
    const client = await window.taalcutProbe?.client;
    if (!client) throw new Error('no app client in the page');
    const before = await client.consents.list();
    const revoked = await client.consents.revoke({ module: 'vision' });
    const again = await client.consents.revoke({ module: 'vision' });
    return { before, revoked, again, after: await client.consents.list() };
  });
  expect(consents).toMatchObject({
    before: [{ module: 'vision', providers: expect.any(Array), grantedAt: expect.any(Number) }],
    revoked: { module: 'vision', revoked: true },
    again: { module: 'vision', revoked: false },
    after: [],
  });
  expect(library.uploadConsents()).toBeUndefined();
  // Main keeps one connection per page and the client took the renderer's: reload, as after an update.
  await page.reload();
  await expect(page).toHaveURL(chatUrl);
  await expect(consentCards()).toHaveCount(1);

  const ask = GATE_DEMO_FOLLOW_UPS[2];
  await composer().fill(ask.ask);
  await composer().press('Enter');
  const asking = consentCards().nth(1);
  await expect(asking.getByRole('button', { name: 'Allow once' }), failedJobs(library.jobs())).toBeEnabled({
    timeout: 30_000,
  });
  await expect(waitingLine()).toBeVisible();
  await expect(asking).toContainText('Describing beach.mov sends one frame of it to Google and OpenAI.');
  await asking.getByRole('button', { name: 'Allow once' }).click();
  await expect(lastAnswer(), failedJobs(library.jobs())).toContainText(ask.answer, { timeout: 30_000 });
  await expect(asking).toContainText('Sent');
  await expect(asking.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
  await expect(waitingLine()).toHaveCount(0);
  // Allow once covers this upload only: nothing stands.
  expect(library.uploadConsents()).toBeUndefined();
});

test('⌘Z in the composer undoes typing; outside it, ⌘Z removes the folder the agent added', async () => {
  expect(library.sourceRoots()).toEqual([trip]);
  // In a text field, ⌘Z is the field's: it takes back typing, and the folder stays.
  await composer().click();
  await composer().pressSequentially('draft');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(composer()).not.toHaveValue('draft');
  await expect(composer()).toHaveValue(/^d/);
  expect(library.sourceRoots()).toEqual([trip]);
  await composer().fill('');

  // Click the transcript, as you would to read it: focus leaves the composer, and ⌘Z is the app's undo.
  await lastAnswer().click();
  await expect(composer()).not.toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => library.sourceRoots()).toEqual([]);
  await expect(composer()).toHaveValue('');
});

test('the trace viewer shows every span with its time, and tokens and cost for model and tool calls', async () => {
  const spans = library.spans(runId);
  expect(spans.filter((s) => s.kind === 'model')).toHaveLength(8);
  await page.goto(`app://taalcut/dev/traces?run=${runId}`);
  await expect(page.getByRole('heading', { name: GATE_DEMO_ASK })).toBeVisible();
  await expect(page.getByText('Complete: every call has its outcome, tokens, cost and time.')).toBeVisible();

  const rows = page.getByRole('list', { name: 'Spans, in order' }).getByRole('listitem');
  await expect(rows).toHaveCount(spans.length);
  let measured = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const row = rows.nth(i).getByRole('button');
    // Every row: how long it took, on screen.
    await expect(row.getByRole('time')).toHaveText(/\d/);
    const text = (await row.textContent()) ?? '';
    // The span the row shows (spans that start in the same millisecond may come in either order).
    const [name] = spans
      .map((span) => span.name)
      .filter((spanName) => text.includes(spanName))
      .sort((a, b) => b.length - a.length);
    expect(name, text).toBeDefined();
    if (!text.includes('Model call') && !text.includes('Tool call')) continue;
    // Model and tool calls: their details, a region named after the span, show tokens, cost and time.
    await row.click();
    await expect(row).toHaveAttribute('aria-current', 'true');
    const details = page.getByRole('region', { name, exact: true });
    for (const fact of ['Took', 'Tokens sent', 'Tokens received', 'Cost'])
      await expect(details, `${text}: ${fact}`).toContainText(fact);
    await expect(details).not.toContainText('Not recorded');
    measured += 1;
  }
  expect(measured).toBe(spans.filter((s) => s.kind === 'model' || s.kind === 'tool').length);
  for (const tool of TOOLS) await expect(rows.filter({ hasText: tool })).toHaveCount(1);
  await expect(rows.filter({ hasText: `${GATE_AGENT.provider}/${GATE_AGENT.model}` })).toHaveCount(8);
});

test('backing checks in the library: one CloudCall row per model call, media jobs done in the jobs process', async () => {
  const calls = library.cloudCalls(runId);
  // Eight agent turns, one vision upload, and the chat title (agent), which carries the run's trace so
  // it counts against the project cap (P2-X1).
  expect(calls).toHaveLength(10);
  expect(calls.every((call) => call.outcome === 'ok')).toBe(true);
  expect(calls.filter((call) => call.module === 'agent')).toHaveLength(9);
  expect(calls.filter((call) => call.module === 'router')).toHaveLength(0);
  expect(calls.filter((call) => call.module === 'vision')).toMatchObject([
    { provider: 'anthropic', local: 0 },
  ]);
  // Four loop turns per follow-up; only the first refines the title before the service restarts.
  for (const [index, ask] of GATE_DEMO_FOLLOW_UPS.entries()) {
    const followedRun = library.runFor(ask.ask) as RunId;
    expect(library.spans(followedRun).filter((span) => span.kind === 'model')).toHaveLength(4);
    await expect
      .poll(() => library.cloudCalls(followedRun).map((call) => [call.module, call.outcome]))
      .toEqual([
        ...Array.from({ length: 3 }, () => ['agent', 'ok']),
        ['vision', 'ok'],
        ['agent', 'ok'],
        ...(index === 0 ? [['agent', 'ok']] : []),
      ]);
  }
  // The jobs table is the jobs process's engine: the probe and the four frames ran there. Indexing the folder
  // carries on in the background (with a built mac helper it also reads on-screen text), so let it finish first.
  await expect.poll(() => unsettledJobs(library.jobs()), { timeout: 60_000 }).toEqual([]);
  const jobs = library.jobs();
  expect(
    jobs.filter((job) => job.kind === 'media.probe').map((job) => job.state),
    failedJobs(jobs),
  ).toEqual(['succeeded']);
  expect(
    jobs.every((job) => job.state === 'succeeded'),
    failedJobs(jobs),
  ).toBe(true);
});
