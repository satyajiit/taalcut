// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M13, the make flow's three PRD journeys in the real app (gate criteria 2
 * and 4), on the make flow's recorded model session (stand-in provider: no
 * key, no network, no cost). The test build runs everything else for real:
 * the agent process with every skill, the jobs process breaking the reel
 * down (FFmpeg, scene cuts, frames, loudness; beats from the onset stand-in)
 * and embedding slot intents (the stand-in EmbeddingGemma), casting on the
 * seeded library, the render process drafting and exporting with
 * HyperFrames, and render's QA gate.
 *
 * - reference-driven: the reel's path typed into the chat → its frames
 *   described with no consent card, each a logged approval → breakdown → casting → assembly → the Editor's text →
 *   a QA-checked draft → the one approval → the export;
 * - swap-then-export: the same up to the approval, then a quick swap in the
 *   review page's Options; on that page, the draft checked again and the
 *   new approval, then export;
 * - brief-driven: "Make a 30 s vlog of my trip" → the vlog format → story
 *   order → … → export.
 *
 * The one approval is made on UX4's review page (review-page.ts): the chat's
 * card opens it, Export and the quick swaps are there, and it goes back to
 * the chat, where the card says Exported.
 *
 * Each journey logs its phases (from the run's event log) and the exported
 * file's properties. Re-record the session with
 * TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=make-flow.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { unwrap } from '@taalcut/core';
import {
  MAKE_FLOW_BRIEF,
  MAKE_FLOW_COMMENTS_ASK,
  MAKE_FLOW_REFERENCE,
  MAKE_FLOW_SWAP_REFERENCE,
  referenceAsk,
} from '@taalcut/gate-demo';
import { createBinaryResolver, type ResolvedFfmpeg } from '@taalcut/media';
import { takeGapProposals } from './gap-card';
import { failedJobs, launchApp, SEND_OFF_HEADING, StartupTimeline } from './gate-support';
import { shellAvailable } from './headless-shell';
import {
  exportedFile,
  makeFlowEnv,
  makeFlowHome,
  jobKinds,
  makeFlowReader,
  networkWatch,
  phaseTimings,
  type MakeFlowHome,
  referenceApprovals,
} from './make-flow-support';
import { editJourney } from './edit-journey';
import { commentsOn, exportedTimeline, leaveThreeComments, sendComments } from './make-flow-comments';
import { approvalAsks, exportHere, exportOnReview, swapOnReview } from './review-page';
import { chatList } from './sidebar';

const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, `no FFmpeg build (${ffmpeg.ok ? '' : ffmpeg.error.code}): run tools/ffmpeg/build.sh`);
test.skip(!shellAvailable(), "no chrome-headless-shell: run e2e:provision, or render's tests once");

/** How long one journey may take; TAALCUT_E2E_FLOW_MS shortens it while diagnosing. */
const FLOW_MS = Number(process.env.TAALCUT_E2E_FLOW_MS ?? 600_000);
/**
 * The home goes under /tmp, not the per-user temp folder: a stored tool result read a page at a time can cut a
 * path before the recorder maps the home to /Users/demo, and then only /tmp shows in the recorded session.
 */
const SHORT_TMP = process.platform === 'darwin' ? '/tmp' : tmpdir();
const QA_PASSED = new Set(['passed', 'passedWithWarnings']);

let app: ElectronApplication;
let page: Page;
let root: string;
let world: MakeFlowHome;
let binaries: ResolvedFfmpeg;
let library: ReturnType<typeof makeFlowReader>;
let network: ReturnType<typeof networkWatch>;

test.describe.configure({ mode: 'serial' });

async function launch(): Promise<void> {
  const start = new StartupTimeline();
  app = await start.step('app launch', 45_000, () => launchApp(world.userData, makeFlowEnv(world.home)));
  start.listen(app);
  page = await start.step('first window', 30_000, () => app.firstWindow());
  await start.step('renderer ready', 15_000, () => page.waitForLoadState('domcontentloaded'));
  await start.step('main connection ready', 20_000, () =>
    page.getByRole('link', { name: 'New chat' }).waitFor(),
  );
  await start.step('agent ready', 20_000, () => chatList(page, 20_000));
}

const transcript = () => page.getByRole('main');
const composer = () => page.getByRole('textbox', { name: 'Message Taalcut' });
const card = (title: string) =>
  transcript()
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
const consentCards = () => card(SEND_OFF_HEADING);
const readyCards = () => card('Ready to export');
const exportsDone = () => transcript().locator('[data-card-type="renderProgress"][data-status="ready"]');
const why = () =>
  `${failedJobs(library.jobs())}; jobs: ${JSON.stringify(jobKinds(library.jobs()))}; renders: ${JSON.stringify(
    library.renders().map((r) => [r.status, r.timelineRevision, r.verdict, r.findings]),
  )}; ${library.latestRun()}`;

/** Waits; a timeout says where the app got to (failed jobs, the run's last events) when it fails. */
async function until<T>(wait: Promise<T>): Promise<T> {
  try {
    return await wait;
  } catch (cause) {
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n\nThe app: ${why()}`, {
      cause,
    });
  }
}

/**
 * Starts a journey in a new chat; returns when the message is in the transcript, with the time it was sent. A
 * replayed run can queue its draft within a tenth of a second of the send, before the message is on screen.
 */
async function ask(text: string): Promise<number> {
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  await composer().fill(text);
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  const sent = Date.now();
  await composer().press('Enter');
  await expect(transcript().getByRole('article').filter({ hasText: /^You:/ }).last()).toContainText(text);
  return sent;
}

/** A reference's frames go without a consent card (FIX-CONSENT): each upload is an approval logged for its call. */
async function referenceSent(text: string): Promise<void> {
  await until(
    expect
      .poll(() => referenceApprovals(library.events(library.runFor(text) ?? '')), { timeout: FLOW_MS })
      .toBeGreaterThan(0),
  );
  await expect(consentCards()).toHaveCount(0);
}

/** The one approval, once the Reviewer's draft passed QA (gate criterion 4); returns the passing draft. */
async function readyToExport(since: number) {
  const ready = readyCards().last();
  await until(approvalAsks(ready, FLOW_MS));
  const drafts = library.renders().filter((render) => render.createdAt >= since);
  const passed = drafts.filter((render) => render.status === 'ready' && QA_PASSED.has(render.verdict ?? ''));
  expect(passed.length, JSON.stringify(drafts)).toBeGreaterThan(0);
  return { ready, draft: passed.at(-1)! };
}

/**
 * Export on UX4's review page (the card's, or `review` when it is open already), and the exported file: back in the
 * chat, the approval card says Exported once the export step is done, its render's progress card says ready, and
 * the file is where the render says. exportMs runs from pressing the page's Export.
 */
async function exportNow(ready: ReturnType<typeof readyCards>, review?: Locator) {
  const clicked = await until(
    review ? exportHere(page, review, FLOW_MS) : exportOnReview(page, ready, FLOW_MS),
  );
  await until(
    expect(ready.getByRole('status').filter({ hasText: 'Exported' })).toBeVisible({ timeout: FLOW_MS }),
  );
  await expect(exportsDone().last()).toBeVisible();
  const exported = library
    .renders()
    .filter((render) => render.status === 'ready' && render.filePath)
    .at(-1)!;
  const file = await exportedFile(binaries, exported.filePath!);
  return { exported, file, exportMs: Date.now() - clicked };
}

/**
 * The review page a swap was made on follows the run: once the Reviewer's draft of the new revision passed QA, the
 * page is on the approval the run asks again with (its link too), shows that draft, and offers Export.
 */
async function reviewAskedAgain(review: Locator, text: string, since: number, after: number) {
  await until(expect(review.locator('[data-slot=review-export]')).toBeEnabled({ timeout: FLOW_MS }));
  await expect(review).toHaveAttribute('data-status', 'pending');
  const drafts = library.renders().filter((render) => render.createdAt >= since);
  const passed = drafts.filter(
    (render) =>
      render.status === 'ready' && QA_PASSED.has(render.verdict ?? '') && render.timelineRevision > after,
  );
  expect(passed.length, JSON.stringify(drafts)).toBeGreaterThan(0);
  const draft = passed.at(-1)!;
  await expect(review.locator('[data-slot=review-stage]')).toHaveAttribute('data-draft', draft.id);
  const asked = library
    .events(library.runFor(text)!)
    .filter((event) => event.type === 'approval.requested' && event.payload.kind === 'tool')
    .at(-1)?.payload.requestId;
  expect(asked).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/review/${String(asked)}$`));
  return draft;
}

const qaOf = (render: {
  verdict: string | null;
  warned: readonly string[];
  qaMs: number;
  createdAt: number;
  finishedAt: number | null;
}) => ({
  verdict: render.verdict,
  warned: render.warned,
  qaMs: render.qaMs,
  renderAndQaMs: (render.finishedAt ?? 0) - render.createdAt,
});

function report(journey: string, text: string, started: number, extra: Record<string, unknown>): void {
  const runId = library.runFor(text)!;
  const timings = phaseTimings(library.events(runId));
  console.warn(
    `[make-flow] ${journey}: ${JSON.stringify({ wallMs: Date.now() - started, timings, ...extra, jobs: jobKinds(library.jobs()) })}`,
  );
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  binaries = unwrap(ffmpeg);
  root = mkdtempSync(join(SHORT_TMP, 'taalcut-e2e-make-'));
  world = await makeFlowHome(root, binaries);
  library = makeFlowReader(world.userData);
  await launch();
  network = networkWatch(app.process().pid!);
});

test.afterAll(async () => {
  network?.stop();
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

test('reference-driven: the reel → breakdown → casting → assembly → QA → one approval → export', async () => {
  test.setTimeout(FLOW_MS * 2);
  const text = referenceAsk(world.reels[MAKE_FLOW_REFERENCE]!);
  const started = await ask(text);
  await referenceSent(text);
  // Two of the reel's five shots get clips casting is unsure of: more than a fifth, so the run asks (FIX-ASK).
  await until(takeGapProposals(transcript(), FLOW_MS));
  const { ready, draft } = await readyToExport(started);
  const { exported, file, exportMs } = await exportNow(ready);
  // The approved export is the draft QA passed: nothing renders twice.
  expect(exported.id).toBe(draft.id);
  expect(file).toMatchObject({ width: 1080, height: 1920, videoCodec: 'h264' });
  expect(file.seconds).toBeGreaterThan(5);
  await expect
    .poll(() => library.telemetry().filter((e) => e.name === 'export.completed'))
    .toEqual([
      expect.objectContaining({
        name: 'export.completed',
        firstExport: true,
        path: 'reference',
        slots: 5,
        slotsKeptAi: 5,
        slotsSwappedByUser: 0,
        orderChanged: false,
        breakdownEdited: false,
      }),
    ]);
  report('reference', text, started, { exportMs, file, qa: qaOf(exported) });
});

test('swap-then-export: a quick swap on the approval, the draft checked again, then export', async () => {
  test.setTimeout(FLOW_MS * 2);
  const text = referenceAsk(world.reels[MAKE_FLOW_SWAP_REFERENCE]!);
  const started = await ask(text);
  await until(takeGapProposals(transcript(), FLOW_MS));
  // A reference's frames never ask: no consent card in this journey either.
  const { ready, draft } = await readyToExport(started);
  await expect(consentCards()).toHaveCount(0);
  // The quick swaps are in the review page's Options (UX4): the second clip, its first other shot. The person
  // stays on the page while the swap is folded in.
  const review = await swapOnReview(page, ready, 1);
  // The swap changes the timeline: the Reviewer drafts the new revision before export is offered again.
  await expect
    .poll(
      () =>
        library.renders().filter((r) => r.createdAt >= started && r.timelineRevision > draft.timelineRevision)
          .length,
      {
        timeout: FLOW_MS,
        message: why(),
      },
    )
    .toBeGreaterThan(0);
  const again = await reviewAskedAgain(review, text, started, draft.timelineRevision);
  const { exported, file, exportMs } = await exportNow(readyCards().last(), review);
  expect(exported.timelineRevision).toBe(again.timelineRevision);
  await expect
    .poll(() =>
      library
        .telemetry()
        .filter((e) => e.name === 'export.completed')
        .at(1),
    )
    .toMatchObject({
      name: 'export.completed',
      firstExport: false,
      path: 'reference',
      slots: 5,
      slotsKeptAi: 4,
      slotsSwappedByUser: 1,
      orderChanged: false,
      breakdownEdited: false,
    });
  report('swap', text, started, { exportMs, file, qa: qaOf(exported) });
});

test('brief-driven: "Make a 30 s vlog of my trip" → format → story order → assembly → QA → export', async () => {
  test.setTimeout(FLOW_MS * 2);
  const started = await ask(MAKE_FLOW_BRIEF);
  // Story casting leaves shots open: the run asks how to fill them before render (FIX-ASK).
  await until(takeGapProposals(transcript(), FLOW_MS));
  const { ready } = await readyToExport(started);
  const { exported, file, exportMs } = await exportNow(ready);
  expect(file).toMatchObject({ width: 1080, height: 1920, videoCodec: 'h264' });
  expect(file.seconds).toBeGreaterThan(20);
  await expect
    .poll(() =>
      library
        .telemetry()
        .filter((e) => e.name === 'export.completed')
        .at(2),
    )
    .toMatchObject({
      name: 'export.completed',
      firstExport: false,
      path: 'describe',
      slotsSwappedByUser: 0,
      orderChanged: false,
      breakdownEdited: false,
    });
  const events = library.telemetry();
  expect(events.filter((e) => e.name === 'flow.started')).toEqual([
    { name: 'flow.started', path: 'reference' },
    { name: 'flow.started', path: 'reference' },
    { name: 'flow.started', path: 'describe' },
  ]);
  expect(events.filter((e) => e.name === 'breakdown.completed')).toHaveLength(2);
  expect(events.filter((e) => e.name === 'cast.completed')).toHaveLength(3);
  expect(events.filter((e) => e.name === 'cost.recorded' && e.scope === 'export')).toHaveLength(3);
  report('brief', MAKE_FLOW_BRIEF, started, { exportMs, file, qa: qaOf(exported) });
});

test('comments (EDT1-CMT): three on the brief’s video, sent together, each resolved with a reply', async () => {
  test.setTimeout(FLOW_MS);
  const video = exportedTimeline(world.userData);
  await leaveThreeComments(page, video);
  const sent = Date.now();
  await until(sendComments(page, FLOW_MS));
  const comments = commentsOn(world.userData, video.timelineId);
  expect(comments.map((c) => [c.author, c.status, !!c.reply])).toEqual([
    ['user', 'resolved', true],
    ['user', 'resolved', true],
    ['user', 'resolved', true],
  ]);
  // One run for the three: it marked them sent and answered each.
  const runId = library.runFor(MAKE_FLOW_COMMENTS_ASK)!;
  const names = library.commandsOf(runId).map((c) => c.name);
  expect(names.filter((n) => n === 'comments.send')).toHaveLength(1);
  expect(names.filter((n) => n === 'comments.reply')).toHaveLength(3);
  console.warn(`[make-flow] comments: ${JSON.stringify({ wallMs: Date.now() - sent, commands: names })}`);
});

test('the editor: "make this half speed and add a crossfade into the next one" shows both (EDT1-OPS)', async () => {
  test.setTimeout(FLOW_MS);
  await editJourney(page, world.userData, FLOW_MS);
});

test('the network test: through all three journeys, nothing connected off this Mac', () => {
  // The models answer from the recording in the agent process, so even the frames the user allowed never leave.
  expect(network.offMac()).toEqual([]);
});
