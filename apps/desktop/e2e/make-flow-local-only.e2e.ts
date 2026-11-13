// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B10 (G27, G9), Local only verified: the reference-driven journey with Local only on and the Local only
 * profile, from the reel's path typed into the chat to the exported file, with no outbound connection from
 * any process. The test build runs it for real (the agent process with every skill, the jobs process breaking
 * the reel down with FFmpeg, casting, HyperFrames drafting and exporting, QA), with two stand-ins: the
 * embedded runtime's components count as installed and its llama-server is the loopback stand-in that
 * answers the make flow's script in llama-server's wire format (utility/roots/agent-local-session.ts). The
 * ModelClient is the production one: Local only refuses every cloud model, on-device turns go over loopback.
 * The one approval is made on UX4's review page (review-page.ts), and the chat's card says Exported.
 *
 * "Zero outbound connections" is measured three ways: the network recorder in main and every utility
 * process (each Node network API wrapped, every attempt logged with its stack, non-loopback refused),
 * Chromium's own requests from every session, and the OS socket table of the whole process tree (lsof).
 *
 * Recording the turns against the real runtime (llama-server with Qwen3.5 4B) needs its components on the
 * Mac; see packages/models/SPEC.md P3.6 for the manual run.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { unwrap } from '@taalcut/core';
import { MAKE_FLOW_REFERENCE, referenceAsk } from '@taalcut/gate-demo';
import { createBinaryResolver, type ResolvedFfmpeg } from '@taalcut/media';
import { takeGapProposals } from './gap-card';
import { failedJobs, launchApp, libraryReader, SEND_OFF_HEADING, StartupTimeline } from './gate-support';
import { shellAvailable } from './headless-shell';
import {
  localOnlyEnv,
  readNetworkLogs,
  runtimeStarted,
  seedLocalOnly,
  servedTurns,
} from './local-only-support';
import {
  exportedFile,
  jobKinds,
  makeFlowHome,
  makeFlowReader,
  networkWatch,
  phaseTimings,
  type MakeFlowHome,
} from './make-flow-support';
import { approvalAsks, exportOnReview } from './review-page';
import { chatList } from './sidebar';

const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, `no FFmpeg build (${ffmpeg.ok ? '' : ffmpeg.error.code}): run tools/ffmpeg/build.sh`);
test.skip(!shellAvailable(), "no chrome-headless-shell: run e2e:provision, or render's tests once");

const FLOW_MS = Number(process.env.TAALCUT_E2E_FLOW_MS ?? 600_000);
const SHORT_TMP = process.platform === 'darwin' ? '/tmp' : tmpdir();
/** Main, Chromium's sessions and the utility processes a journey starts. */
const RECORDED_PROCESSES = ['agent', 'chromium', 'jobs', 'main', 'render'];

let app: ElectronApplication;
let page: Page;
let root: string;
let world: MakeFlowHome;
let binaries: ResolvedFfmpeg;
let folders: { network: string; session: string };
let reader: ReturnType<typeof makeFlowReader>;
let sockets: ReturnType<typeof networkWatch>;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  binaries = unwrap(ffmpeg);
  root = mkdtempSync(join(SHORT_TMP, 'taalcut-e2e-local-'));
  world = await makeFlowHome(root, binaries);
  await seedLocalOnly(world.userData);
  folders = { network: join(root, 'network'), session: join(root, 'session') };
  for (const dir of Object.values(folders)) mkdirSync(dir, { recursive: true });
  reader = makeFlowReader(world.userData);
  const start = new StartupTimeline();
  app = await start.step('app launch', 45_000, () =>
    launchApp(world.userData, localOnlyEnv(world.home, folders)),
  );
  start.listen(app);
  sockets = networkWatch(app.process().pid!);
  page = await start.step('first window', 30_000, () => app.firstWindow());
  await start.step('agent ready', 30_000, () => chatList(page, 30_000));
  // The hardware probe tells the on-device runtime the tier before the first model turn.
  await expect.poll(() => runtimeStarted(folders.session), { timeout: 60_000 }).toBeTruthy();
});

test.afterAll(async () => {
  sockets?.stop();
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

const transcript = () => page.getByRole('main');
const card = (title: string) =>
  transcript()
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
const why = () =>
  `${failedJobs(reader.jobs())}; jobs: ${JSON.stringify(jobKinds(reader.jobs()))}; ${reader.latestRun()}`;

async function until(wait: Promise<unknown>): Promise<void> {
  try {
    await wait;
  } catch (cause) {
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n\nThe app: ${why()}`, {
      cause,
    });
  }
}

test('Local only: the reel → breakdown → casting → assembly → QA → export, all on this Mac', async () => {
  test.setTimeout(FLOW_MS * 2);
  const text = referenceAsk(world.reels[MAKE_FLOW_REFERENCE]!);
  const started = Date.now();
  await page.getByRole('link', { name: 'New chat' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Taalcut' });
  await composer.fill(text);
  await composer.press('Enter');

  // Vision runs on this Mac, so nothing asks to leave it. A cast the run asks about on the gapFix card gets Taalcut's
  // proposals taken (FIX-ASK, gap-card.ts); then the one card is the export's.
  await until(takeGapProposals(transcript(), FLOW_MS));
  const ready = card('Ready to export').last();
  await until(approvalAsks(ready, FLOW_MS));
  expect(await card(SEND_OFF_HEADING).count()).toBe(0);
  await until(exportOnReview(page, ready, FLOW_MS));
  await until(
    expect(ready.getByRole('status').filter({ hasText: 'Exported' })).toBeVisible({ timeout: FLOW_MS }),
  );

  const exported = reader
    .renders()
    .filter((render) => render.status === 'ready' && render.filePath)
    .at(-1);
  expect(exported, why()).toBeTruthy();
  const file = await exportedFile(binaries, exported!.filePath!);
  expect(file).toMatchObject({ width: 1080, height: 1920, videoCodec: 'h264' });

  const library = libraryReader(world.userData);
  const runId = library.runFor(text)!;
  const events = reader.events(runId);
  expect(events.find((e) => e.type === 'run.started')?.payload).toMatchObject({ localOnly: true });
  // Every model call this run made stayed on this Mac, on the embedded runtime.
  const calls = library.cloudCalls(runId);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((call) => call.local !== 1)).toEqual([]);
  expect(new Set(calls.map((call) => call.provider))).toEqual(new Set(['on-device']));
  const turns = servedTurns(folders.session);
  expect(turns.some((turn) => turn.kind === 'vision')).toBe(true);
  expect(turns.some((turn) => turn.kind === 'agent')).toBe(true);
  // A file needs no downloader. Catch a wrong model choice even if it later recovers and exports.
  expect(
    events.filter((e) => e.type === 'tool.requested' && e.payload.tool === 'templates.fetchReference'),
  ).toEqual([]);
  // Both policy layers must let every step of this entirely local happy path run.
  const refused = events.filter(
    (e) =>
      (e.type === 'tool.failed' || e.type === 'model.failed') &&
      ['core.local_only', 'tools.permission_denied'].includes(errorCode(e.payload) ?? ''),
  );
  expect(refused).toEqual([]);

  console.warn(
    `[local-only] ${JSON.stringify({
      wallMs: Date.now() - started,
      tier: runtimeStarted(folders.session)?.tier,
      timings: phaseTimings(events),
      modelCalls: calls.length,
      servedTurns: turns.length,
      refusedTools: refused.map((e) => e.payload.toolCallId),
      file,
    })}`,
  );
});

test('the network test: every process recorded, and not one connection off this Mac', () => {
  const logs = readNetworkLogs(folders.network);
  for (const name of RECORDED_PROCESSES) expect(logs.installed, name).toContain(name);
  expect(logs.attempts.filter((attempt) => !attempt.allowed)).toEqual([]);
  // The on-device turns did go over loopback: the recorder saw them.
  expect(logs.attempts.some((a) => a.process === 'agent' && a.allowed)).toBe(true);
  expect(sockets.offMac()).toEqual([]);
});

function errorCode(payload: Record<string, unknown>): string | undefined {
  const error = payload.error;
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
