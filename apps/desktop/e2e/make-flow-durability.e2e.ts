// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M13, gate criterion 9 for the make flow: kill -9 a process mid-flow and
 * nothing the user was told is done is lost. On the make flow's recorded
 * session, as make-flow.e2e.ts sets it up:
 *
 * - the agent, mid-breakdown: main restarts it and offers the run; "Resume
 *   the task" picks it up. The breakdown the agent waited on runs on (main
 *   reads its stream to the end, runner-forward.ts) and the resumed tool
 *   joins it by its key: one breakdown, and the flow reaches its export;
 * - the jobs process, mid-breakdown (the other reel's) and mid-render (the
 *   brief's vlog): its supervisor restarts it and the queue takes the job
 *   over; the tool asks for it again by its key (agent-job-runner.ts), the
 *   render process keeps the in-flight export going (runner-forward.ts) so
 *   the reclaimed job joins it, and the flow reaches its export;
 * - the agent, mid-edit (the Editor's text edits on the brief's vlog, in a
 *   fresh app): resumed, every edit is in the timeline once and the flow
 *   reaches its export;
 * - the render process, mid-render: the render job retries on a new one.
 *
 * After each: the commands the user saw done are in the audit log exactly
 * once, and the conversation still holds every card it showed. Each flow's
 * one approval is made on UX4's review page (review-page.ts).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { unwrap } from '@taalcut/core';
import {
  MAKE_FLOW_BRIEF,
  MAKE_FLOW_REFERENCE,
  MAKE_FLOW_SWAP_REFERENCE,
  referenceAsk,
} from '@taalcut/gate-demo';
import { createBinaryResolver } from '@taalcut/media';
import { alive } from './durability-helpers';
import { takeGapProposals } from './gap-card';
import { failedJobs, launchApp, SEND_OFF_HEADING } from './gate-support';
import { shellAvailable } from './headless-shell';
import {
  makeFlowEnv,
  makeFlowHome,
  jobKinds,
  makeFlowReader,
  referenceApprovals,
  type MakeFlowHome,
} from './make-flow-support';
import { approvalAsks, exportOnReview } from './review-page';
import { chatList } from './sidebar';
import { utilityPid } from './utility-pids';

const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, `no FFmpeg build (${ffmpeg.ok ? '' : ffmpeg.error.code}): run tools/ffmpeg/build.sh`);
test.skip(!shellAvailable(), "no chrome-headless-shell: run e2e:provision, or render's tests once");

const FLOW_MS = Number(process.env.TAALCUT_E2E_FLOW_MS ?? 600_000);
/**
 * The home goes under /tmp, not the per-user temp folder: a stored tool result read a page at a time can cut a
 * path before the recorder maps the home to /Users/demo, and then only /tmp shows in the recorded session.
 */
const SHORT_TMP = process.platform === 'darwin' ? '/tmp' : tmpdir();

let app: ElectronApplication;
let page: Page;
let root: string;
let world: MakeFlowHome;
let library: ReturnType<typeof makeFlowReader>;

test.describe.configure({ mode: 'serial' });

const transcript = () => page.getByRole('main');
const composer = () => page.getByRole('textbox', { name: 'Message Taalcut' });
const card = (title: string) =>
  transcript()
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
const why = () =>
  `${failedJobs(library.jobs())}; jobs: ${JSON.stringify(jobKinds(library.jobs()))}; renders: ${JSON.stringify(
    library.renders().map((r) => [r.status, r.timelineRevision, r.verdict]),
  )}; ${library.latestRun()}`;

async function until(wait: Promise<unknown>): Promise<void> {
  try {
    await wait;
  } catch (cause) {
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n\nThe app: ${why()}`, {
      cause,
    });
  }
}

const pidOf = (name: 'agent' | 'jobs' | 'render') => utilityPid(app, name);

async function kill(name: 'agent' | 'jobs' | 'render'): Promise<number> {
  const pid = await pidOf(name);
  expect(pid, `no ${name} process`).toBeDefined();
  process.kill(pid!, 'SIGKILL');
  await expect.poll(() => alive(pid!), { timeout: 10_000 }).toBe(false);
  return pid!;
}

async function ask(text: string): Promise<number> {
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  await composer().fill(text);
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await composer().press('Enter');
  await expect(transcript().getByRole('article').filter({ hasText: /^You:/ }).last()).toContainText(text);
  return Date.now();
}

/**
 * The agent came back: the window's recovery prompt offers the run, and resuming it reloads the open
 * conversation and follows the resumed run in place.
 */
async function resume(): Promise<void> {
  const prompt = page.getByRole('dialog', { name: 'The agent restarted' });
  await until(expect(prompt).toBeVisible({ timeout: 30_000 }));
  await prompt.getByRole('button', { name: 'Resume the task' }).click();
  await expect(prompt).toBeHidden();
}

/**
 * Exports on the review page once QA passed. For a reel's ask (`reelAsk`), first checks that its frames went without a
 * consent card (FIX-CONSENT), each a logged approval. A cast that asks on the gapFix card gets Taalcut's proposals
 * taken first (FIX-ASK, gap-card.ts).
 */
async function finish(since: number, reelAsk?: string): Promise<void> {
  if (reelAsk) {
    await until(
      expect
        .poll(() => referenceApprovals(library.events(library.runFor(reelAsk) ?? '')), { timeout: FLOW_MS })
        .toBeGreaterThan(0),
    );
    await expect(card(SEND_OFF_HEADING)).toHaveCount(0);
  }
  await until(takeGapProposals(transcript(), FLOW_MS));
  const ready = card('Ready to export').last();
  await until(approvalAsks(ready, FLOW_MS));
  await until(exportOnReview(page, ready, FLOW_MS));
  await until(
    expect
      .poll(
        () =>
          library.renders().filter((r) => r.createdAt >= since && r.status === 'ready' && r.filePath).length,
        {
          timeout: FLOW_MS,
        },
      )
      .toBeGreaterThan(0),
  );
}

/** Each command the run's tools dispatched is in the audit log once: a resumed run never applies one again. */
function commandsOnce(text: string): void {
  const runId = library.runFor(text)!;
  const commands = library.commandsOf(runId);
  expect(commands.length).toBeGreaterThan(0);
  const keys = commands.map((command) => command.key).filter((key) => key !== null);
  expect(new Set(keys).size, JSON.stringify(commands)).toBe(keys.length);
  const edits = library
    .events(runId)
    .filter((event) => event.type === 'tool.requested' && event.payload.tool === 'timeline.editText');
  const editIds = new Set(edits.map((event) => JSON.stringify(event.payload.input)));
  expect(commands.filter((command) => command.name === 'timeline.editText')).toHaveLength(editIds.size);
}

/** A fresh home, library and app: the recorded session replays each ask once per agent process. */
async function launchFresh(name: string): Promise<void> {
  await app?.close().catch(() => undefined);
  mkdirSync(join(root, name));
  world = await makeFlowHome(join(root, name), unwrap(ffmpeg));
  library = makeFlowReader(world.userData);
  app = await launchApp(world.userData, makeFlowEnv(world.home));
  page = await app.firstWindow();
  await chatList(page, 60_000);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  root = mkdtempSync(join(SHORT_TMP, 'taalcut-e2e-make-kill-'));
  await launchFresh('first');
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (root) rmSync(root, { recursive: true, force: true });
});

test('kill -9 the agent mid-breakdown: resumed, the breakdown is not run twice, the flow exports', async () => {
  test.setTimeout(FLOW_MS * 2);
  const text = referenceAsk(world.reels[MAKE_FLOW_REFERENCE]!);
  const since = await ask(text);
  await until(
    expect
      .poll(
        () =>
          library.jobs().filter((job) => job.kind === 'templates.breakdown' && job.state === 'running')
            .length,
        {
          timeout: FLOW_MS,
        },
      )
      .toBe(1),
  );
  await kill('agent');
  await resume();
  await finish(since, text);
  // The job the agent waited on ran on, and the resumed tool joined it: one breakdown, none cancelled.
  const breakdowns = library.jobs().filter((job) => job.kind === 'templates.breakdown');
  expect(breakdowns.map((job) => job.state)).toEqual(['succeeded']);
  commandsOnce(text);
});

test('kill -9 the jobs process mid-breakdown: the job is taken over, the tool waits on, the flow exports', async () => {
  test.setTimeout(FLOW_MS * 2);
  // The agent restarted in the test before: the other reel's ask replays in this process. Its frames ask no consent.
  const text = referenceAsk(world.reels[MAKE_FLOW_SWAP_REFERENCE]!);
  const breakdowns = () => library.jobs().filter((job) => job.kind === 'templates.breakdown');
  const before = breakdowns().length;
  const since = await ask(text);
  await until(
    expect
      .poll(() => breakdowns().filter((job) => job.state === 'running').length, { timeout: FLOW_MS })
      .toBe(1),
  );
  await kill('jobs');
  await finish(since, text);
  // The job the dead process held is the one that finished: taken over, not started again.
  expect(
    breakdowns()
      .slice(before)
      .map((job) => job.state),
  ).toEqual(['succeeded']);
  commandsOnce(text);
});

test('kill -9 the jobs process mid-render: the render continues and the reclaimed job joins it, the flow exports', async () => {
  test.setTimeout(FLOW_MS * 2);
  // The brief journey has not played in this agent process yet; it needs no upload consent.
  const exports = () => library.jobs().filter((job) => job.kind === 'render.export');
  const before = exports().length;
  const since = await ask(MAKE_FLOW_BRIEF);
  const rendering = () => exports().some((job) => job.state === 'running');
  // The draft renders after the gaps question, which story casting asks (FIX-ASK).
  await until(takeGapProposals(transcript(), FLOW_MS, rendering));
  await until(expect.poll(rendering, { timeout: FLOW_MS }).toBe(true));
  await kill('jobs');
  await finish(since);
  // The render job the dead process held was reclaimed and joined the in-flight render: none cancelled or failed.
  expect(
    exports()
      .slice(before)
      .every((job) => job.state === 'succeeded'),
  ).toBe(true);
  commandsOnce(MAKE_FLOW_BRIEF);
});

test('kill -9 the agent mid-edit: resumed, each text edit is applied once, the flow exports', async () => {
  test.setTimeout(FLOW_MS * 2);
  // A fresh app and home, so this test and the next start from nothing (the next asks for the upload again).
  await launchFresh('second');
  const since = await ask(MAKE_FLOW_BRIEF);
  // The Editor has asked for its first text edit (the vlog format has text; a reel's template has none): the agent goes
  // now. A gaps question asked first is answered with Taalcut's proposals (FIX-ASK).
  const editing = () =>
    library
      .events(library.runFor(MAKE_FLOW_BRIEF) ?? '')
      .some((e) => e.type === 'tool.requested' && e.payload.tool === 'timeline.editText');
  await until(takeGapProposals(transcript(), FLOW_MS, editing));
  await until(expect.poll(editing, { timeout: FLOW_MS }).toBe(true));
  await kill('agent');
  await resume();
  await finish(since);
  commandsOnce(MAKE_FLOW_BRIEF);
});

test('kill -9 the render process mid-render: the render job retries on a new one, the flow exports', async () => {
  test.setTimeout(FLOW_MS * 2);
  // The agent restarted in the test before: the other reel's ask replays in this process. Its frames ask no consent.
  const text = referenceAsk(world.reels[MAKE_FLOW_SWAP_REFERENCE]!);
  const since = await ask(text);
  const rendering = () =>
    library.jobs().some((job) => job.kind === 'render.export' && job.state === 'running');
  // The draft renders after the gaps question, which this reel's cast asks (FIX-ASK).
  await until(takeGapProposals(transcript(), FLOW_MS, rendering));
  await until(expect.poll(rendering, { timeout: FLOW_MS }).toBe(true));
  await expect.poll(() => pidOf('render'), { timeout: 30_000 }).toBeDefined();
  await kill('render');
  await finish(since, text);
  commandsOnce(text);
});
