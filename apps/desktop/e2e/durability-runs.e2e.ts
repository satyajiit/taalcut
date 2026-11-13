// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 5, the agent-run half: the gate demo's run (recorded model
 * session, as gate.e2e.ts sets it up) killed mid-run, then resumed. The kill
 * lands while the run waits on its media.probe job: the jobs process is
 * frozen with SIGSTOP first, so the run is held at that tool call.
 *
 * - kill -9 main: the relaunch's recovery report lists the run as unfinished;
 *   resuming it (recovery.resumeRuns, the prompt's button) probes again,
 *   stops on the upload consent, and after approval finishes with the
 *   recorded answer. library.addSource, dispatched before the kill, is in the
 *   source table and the audit log once.
 * - kill -9 the agent only: main notices the restart, reads the runs again
 *   as the launch path does, and within seconds its recovery report lists
 *   the run and the window gets `recovery.changed`; resuming it on the
 *   restarted agent finishes it the same way.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { newId, type ConversationId, type RunId } from '@taalcut/core';
import { GATE_DEMO_ANSWER, GATE_DEMO_ASK, GATE_DEMO_FIXTURES } from '@taalcut/gate-demo';
import { libraryPath } from '../src/shared/library-path';
import {
  alive,
  appWideCommands,
  ffmpegDir,
  launchApp,
  makeGateVideo,
  utilityPid,
} from './durability-helpers';

const ffmpeg = ffmpegDir();
test.skip(!ffmpeg, 'no FFmpeg build (tools/ffmpeg/dist or TAALCUT_FFMPEG_DIR): run tools/ffmpeg/build.sh');

interface Sent {
  readonly items: { type: string; runId?: string; payload?: Record<string, unknown> }[];
  error: string | null;
  done: boolean;
}

let app: ElectronApplication;
let page: Page;
let root = '';
let home = '';
let trip = '';
let userData = '';
/** Processes frozen with SIGSTOP; killed at the end if still there. */
const frozen: number[] = [];

test.describe.configure({ mode: 'serial' });

async function launch(): Promise<void> {
  ({ app, page } = await launchApp(userData, {
    HOME: home,
    TAALCUT_TEST_RECORDED_MODELS: GATE_DEMO_FIXTURES,
    ...(ffmpeg ? { TAALCUT_FFMPEG_DIR: ffmpeg } : {}),
  }));
}

/** Sends the gate demo's request in the background; its items collect on window.__sent. */
async function startSend(conversationId: ConversationId): Promise<void> {
  await page.evaluate(
    async ({ id, text }) => {
      const rpc = await window.taalcutProbe?.client;
      if (!rpc) throw new Error('no client');
      const state: Sent = { items: [], error: null, done: false };
      (window as unknown as { __sent: Sent }).__sent = state;
      void (async () => {
        try {
          for await (const item of await rpc.chat.send({ conversationId: id, text }))
            state.items.push(item as Sent['items'][number]);
        } catch (error) {
          state.error = (error as { data?: { code?: string } }).data?.code ?? String(error);
        }
        state.done = true;
      })();
    },
    { id: conversationId, text: GATE_DEMO_ASK },
  );
}

function sent(): Promise<Sent> {
  return page.evaluate(() => structuredClone((window as unknown as { __sent: Sent }).__sent));
}

/** Freezes the jobs process, sends the request, and waits until the run is in its media.probe call. */
async function holdRunAtProbe(conversationId: ConversationId): Promise<{ runId: RunId; jobs: number }> {
  const jobs = (await utilityPid(app, 'jobs')) as number;
  process.kill(jobs, 'SIGSTOP');
  frozen.push(jobs);
  await startSend(conversationId);
  const startedProbe = async () =>
    (await sent()).items.some(
      (item) => item.type === 'agent.toolStarted' && item.payload?.tool === 'media.probe',
    );
  await expect.poll(startedProbe, { timeout: 15_000 }).toBe(true);
  const runId = (await sent()).items[0]?.runId as RunId;
  expect(runId).toBeTruthy();
  return { runId, jobs };
}

/** The status of the run's last agent.runFinished in the conversation, if any. */
function lastFinish(conversationId: ConversationId, runId: RunId): Promise<string | undefined> {
  return page.evaluate(
    async ({ id, run }) => {
      const rpc = await window.taalcutProbe?.client;
      const history = (await rpc?.chat.getConversation({ id }))?.history ?? [];
      const finished = history.filter(
        (event) => event.type === 'agent.runFinished' && event.payload.runId === run,
      );
      const last = finished.at(-1);
      return last?.type === 'agent.runFinished' ? last.payload.status : undefined;
    },
    { id: conversationId, run: runId },
  );
}

/** Resumes the run as the recovery prompt does, approves the upload, and checks the recorded answer. */
async function resumeAndFinish(conversationId: ConversationId, runId: RunId): Promise<void> {
  await page.evaluate(async (run) => {
    const rpc = await window.taalcutProbe?.client;
    await rpc?.recovery.resumeRuns({ runIds: [run] });
  }, runId);
  // It probes again and stops on the upload's consent, as the uninterrupted run does.
  await expect.poll(() => lastFinish(conversationId, runId), { timeout: 30_000 }).toBe('paused');
  const answer = await page.evaluate(
    async ({ id, run }) => {
      const rpc = await window.taalcutProbe?.client;
      if (!rpc) throw new Error('no client');
      const history = (await rpc.chat.getConversation({ id })).history;
      // The upload asks with a consent card.
      const asked = history.flatMap((event) =>
        event.type === 'agent.card' &&
        event.payload.runId === run &&
        event.payload.card.type === 'consent' &&
        event.payload.card.status === 'pending'
          ? [event.payload.card.approvalId]
          : [],
      );
      const last = asked.at(-1);
      if (!last) throw new Error('no consent card');
      await rpc.chat.decideApproval({
        runId: run,
        approvalId: last,
        decision: 'approve',
        remember: false,
      });
      const after = (await rpc.chat.getConversation({ id })).history;
      return after.flatMap((event) =>
        event.type === 'agent.messageDelta' && event.payload.runId === run ? [event.payload.delta] : [],
      );
    },
    { id: conversationId, run: runId },
  );
  expect(await lastFinish(conversationId, runId)).toBe('succeeded');
  expect(answer.at(-1)).toBe(GATE_DEMO_ANSWER);
}

/** This launch's recovery report, as the prompt reads it. */
function recoveryReport() {
  return page.evaluate(async () => (await window.taalcutProbe?.client)?.recovery.report());
}

/** Collects recovery.changed events on window.__recovery, as the renderer's prompt would listen. */
async function watchRecoveryEvents(): Promise<void> {
  await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) throw new Error('no client');
    const seen: unknown[] = [];
    (window as unknown as { __recovery: unknown[] }).__recovery = seen;
    const stream = await rpc.events.subscribe({ types: ['recovery.changed'] });
    void (async () => {
      for await (const event of stream) seen.push(event.payload);
    })();
  });
}

function recoveryEvents(): Promise<unknown[]> {
  return page.evaluate(() => structuredClone((window as unknown as { __recovery: unknown[] }).__recovery));
}

/** library.addSource as this run dispatched it: once in the audit log, one source row. */
function expectSourceAddedOnce(runId: RunId): void {
  const added = appWideCommands(userData).filter(
    (row) => row.name === 'library.addSource' && row.actor === `agent:${runId}`,
  );
  expect(added).toHaveLength(1);
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    const rows = db.prepare('SELECT root_path FROM sources').all() as { root_path: string }[];
    expect(rows.map((row) => row.root_path)).toEqual([trip]);
  } finally {
    db.close();
  }
}

test.beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-e2e-durability-runs-')));
  home = join(root, 'home');
  trip = join(home, 'Desktop', 'Trip');
  userData = join(root, 'user-data');
  mkdirSync(trip, { recursive: true });
  mkdirSync(userData);
  await makeGateVideo(join(trip, 'beach.mov'));
  writeFileSync(join(trip, 'notes.txt'), 'not a video');
  await launch();
});

test.afterAll(async () => {
  for (const pid of frozen) if (alive(pid)) process.kill(pid, 'SIGKILL');
  await app?.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
});

test('kill -9 main mid-run: the report lists the run, and resuming it finishes it with no command twice', async () => {
  test.setTimeout(120_000);
  const conversationId = newId<'Conversation'>();
  const { runId, jobs } = await holdRunAtProbe(conversationId);
  const old = [app.process().pid, await utilityPid(app, 'agent'), jobs];
  process.kill(old[0] as number, 'SIGKILL');
  // A frozen process can't exit when its parent goes; it would have, so it goes too.
  process.kill(jobs, 'SIGKILL');
  await expect
    .poll(() => old.filter((pid) => pid !== undefined && alive(pid)), { timeout: 10_000 })
    .toEqual([]);

  await launch();
  const report = await page.evaluate(async () => (await window.taalcutProbe?.client)?.recovery.report());
  expect(report?.unfinishedRuns).toContainEqual(expect.objectContaining({ runId, status: 'running' }));
  expect(report?.needsAttention).toBe(true);

  await resumeAndFinish(conversationId, runId);
  expectSourceAddedOnce(runId);
});

test('kill -9 the agent mid-run: main offers the run again within seconds, and resuming finishes it', async () => {
  test.setTimeout(120_000);
  // A fresh app and library: the recorded session replays each exchange once per agent process.
  await app.close();
  userData = join(root, 'user-data-2');
  mkdirSync(userData);
  await launch();
  expect((await recoveryReport())?.needsAttention).toBe(false);
  await watchRecoveryEvents();
  const conversationId = newId<'Conversation'>();
  const { runId, jobs } = await holdRunAtProbe(conversationId);
  const agent = (await utilityPid(app, 'agent')) as number;
  process.kill(agent, 'SIGKILL');
  process.kill(jobs, 'SIGCONT');
  await expect.poll(async () => (await sent()).done, { timeout: 10_000 }).toBe(true);
  expect((await sent()).error).toBe('core.process_restarted');

  // The supervisor restarts the agent; main reads the runs again and tells the window, as at launch.
  await expect
    .poll(() => recoveryEvents(), { timeout: 5_000, intervals: [50] })
    .toEqual([{ reason: 'agent-restarted', unfinishedRuns: 1 }]);
  const report = await recoveryReport();
  expect(report?.needsAttention).toBe(true);
  expect(report?.unfinishedRuns).toEqual([expect.objectContaining({ runId, status: 'running' })]);
  expect(await utilityPid(app, 'agent')).not.toBe(agent);

  await resumeAndFinish(conversationId, runId);
  expectSourceAddedOnce(runId);
  // Resuming counts as seeing the offer.
  expect((await recoveryReport())?.needsAttention).toBe(false);
});
