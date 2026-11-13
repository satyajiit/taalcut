// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-B2's RPC wiring, end to end on the unpackaged build: the placeholder
 * renderer's client (src/placeholder/probe.ts) calls main, which answers
 * diagnostics.main itself and forwards diagnostics.agent and diagnostics.jobs
 * over each utility process's port. A killed utility process is back within
 * 2 s, and calls in flight when it died reject with core.process_restarted.
 * The 2 s hold on a machine that isn't overloaded. On one that is (a 1-minute
 * load average over the core count), fork, compose and serve wait for a core
 * like everything else, so only a 10 s ceiling applies there: it still
 * catches a process that isn't restarted, or a crash streak's backoff. The
 * time taken and the load are always reported.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchElectron } from './launch';
import { utilityPid as pidOf } from './utility-pids';

let app: ElectronApplication;
let page: Page;
let userData: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-e2e-rpc-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  app = await launchElectron(userData, { env });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

type Target = 'main' | 'agent' | 'jobs';

const RESTART_MS = 2_000;
const OVERLOADED_RESTART_MS = 10_000;

/** P1-B2's 2 s, or the ceiling when the machine is overloaded. Read after the restart, so it covers it. */
function restartBudget(): { ms: number; note: string } {
  const load = loadavg()[0] ?? 0;
  const cores = availableParallelism();
  const overloaded = load > cores;
  return {
    ms: overloaded ? OVERLOADED_RESTART_MS : RESTART_MS,
    note: `load ${load.toFixed(1)} on ${cores} cores${overloaded ? ', overloaded' : ''}`,
  };
}

const utilityPid = (name: 'agent' | 'jobs') => pidOf(app, name);

/** diagnostics.<target>.ping() from the page: the answering pid, or the error code. */
function ping(target: Target): Promise<number | string> {
  return page.evaluate(async (process) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.diagnostics[process].ping().then(
      (pong) => pong.pid,
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    );
  }, target);
}

test('the renderer reaches main, agent and jobs through its one port', async () => {
  await expect.poll(() => utilityPid('agent'), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(() => utilityPid('jobs'), { timeout: 5_000 }).toBeGreaterThan(0);
  expect(await ping('main')).toBe(await app.evaluate(() => process.pid));
  expect(await ping('agent')).toBe(await utilityPid('agent'));
  expect(await ping('jobs')).toBe(await utilityPid('jobs'));

  const answers = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return null;
    const ticks: number[] = [];
    for await (const tick of await rpc.diagnostics.agent.ticks({ count: 5, intervalMs: 10 }))
      ticks.push(tick.seq);
    return {
      agent: await rpc.diagnostics.agent.echo({ text: 'नमस्ते' }),
      jobs: await rpc.diagnostics.jobs.echo({ text: 'olá' }),
      ticks,
      // The job engine over the library's jobs table, in the jobs process.
      queued: await rpc.jobs.list(),
    };
  });
  expect(answers).toEqual({
    agent: { text: 'नमस्ते', process: 'agent' },
    jobs: { text: 'olá', process: 'jobs' },
    ticks: [0, 1, 2, 3, 4],
    queued: [],
  });
});

test('main validates input before forwarding', async () => {
  const code = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    return rpc?.diagnostics.agent.ticks({ count: 0 }).then(
      () => 'resolved',
      (error: { data?: { code?: string } }) => error.data?.code,
    );
  });
  expect(code).toBe('core.validation');
});

test('chat.stop reaches the agent process: a run it never had is not found', async () => {
  const codes = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    const code = (error: { data?: { code?: string } }) => error.data?.code;
    return Promise.all([
      rpc?.chat.stop({ runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' as never }).then(() => 'resolved', code),
      rpc?.chat.stop({ runId: 'not-a-run' as never }).then(() => 'resolved', code),
    ]);
  });
  expect(codes).toEqual(['core.not_found', 'core.validation']);
});

for (const name of ['jobs', 'agent'] as const) {
  test(`killing ${name}: calls in flight reject with ProcessRestarted, and it is back within 2 s`, async () => {
    const before = await utilityPid(name);
    expect(before).toBeGreaterThan(0);

    const inFlight = page.evaluate(async (process) => {
      const rpc = await window.taalcutProbe?.client;
      if (!rpc) return null;
      const code = (error: { data?: { code?: string } }) => error.data?.code ?? String(error);
      const echo = rpc.diagnostics[process]
        .echo({ text: 'slow', delayMs: 30_000 })
        .then(() => 'resolved', code);
      const stream = (async () => {
        try {
          for await (const tick of await rpc.diagnostics[process].ticks({ count: 1000, intervalMs: 20 }))
            void tick;
          return 'ended';
        } catch (error) {
          return code(error as { data?: { code?: string } });
        }
      })();
      return Promise.all([echo, stream]);
    }, name);
    await page.waitForTimeout(300);

    const killedAt = Date.now();
    process.kill(before as number, 'SIGKILL');
    expect(await inFlight).toEqual(['core.process_restarted', 'core.process_restarted']);

    // Wait up to the ceiling, so a slow restart is measured rather than cut off.
    await expect
      .poll(
        async () => {
          const pid = await ping(name);
          return typeof pid === 'number' && pid !== before;
        },
        { timeout: OVERLOADED_RESTART_MS, intervals: [50] },
      )
      .toBe(true);
    const tookMs = Date.now() - killedAt;
    const budget = restartBudget();
    test.info().annotations.push({
      type: `${name} restart`,
      description: `${tookMs} ms (budget ${budget.ms} ms, ${budget.note})`,
    });
    expect(tookMs, `back after ${tookMs} ms; ${budget.note}`).toBeLessThan(budget.ms);
    expect(await ping(name)).toBe(await utilityPid(name));
  });
}
