// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X5 through the unpackaged app: feedback with and without a debug bundle
 * reaches a loopback ingest, the bundle has main logs plus the agent and jobs
 * sections, and a crash report is posted only after opt-in survives a relaunch.
 * Traces are included when a run is in the log; a fresh launch has none.
 * Packaged forced crashes stay in the packaged project.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { startIngest, type MockIngest } from '../test/helpers/mock-ingest';
import { launchElectron } from './launch';
import { utilityPid as pidOf } from './utility-pids';

let app: ElectronApplication;
let page: Page;
let userData: string;
let ingest: MockIngest;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ingest = await startIngest();
  userData = mkdtempSync(join(tmpdir(), 'taalcut-e2e-feedback-'));
  await launchApp();
});

test.afterAll(async () => {
  await app?.close();
  await ingest?.close();
  rmSync(userData, { recursive: true, force: true });
});

async function launchApp(): Promise<void> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  app = await launchElectron(userData, { env }, [`--taalcut-crash-dsn=${ingest.dsn}`]);
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => utilityPid('agent'), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => utilityPid('jobs'), { timeout: 15_000 }).toBeGreaterThan(0);
}

const utilityPid = (name: 'agent' | 'jobs') => pidOf(app, name);

test('feedback sends with and without a debug bundle', async () => {
  const plain = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.feedback.send({ message: 'e2e feedback without a bundle', bundle: null }).then(
      (sent) => sent.id,
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    );
  });
  expect(plain).toMatch(/^[0-9a-f]{32}$/);
  await expect.poll(() => ingest.bodies.length).toBe(1);
  const plainText = ingest.bodies[0]!.toString('utf8');
  expect(plainText).toContain('e2e feedback without a bundle');
  expect(plainText).not.toContain('event.attachment');

  const preview = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return null;
    const result = await rpc.feedback.preview({});
    return result.sections.map((section) => section.section);
  });
  expect(preview).toEqual(expect.arrayContaining(['logs', 'settings', 'jobs', 'components']));

  const bundled = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.feedback
      .send({ message: 'e2e feedback with a bundle', bundle: {} })
      .then(
        (sent) => sent.id,
        (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
      );
  });
  expect(bundled).toMatch(/^[0-9a-f]{32}$/);
  await expect.poll(() => ingest.bodies.length).toBe(2);
  const attachment = gzipAttachment(ingest.bodies[1]!);
  expect(attachment).toContain('main/logs.txt');
  expect(attachment).toContain('agent/settings.json');
  expect(attachment).toContain('jobs/rows.ndjson');
  expect(attachment).not.toContain(userData);
});

test('a crash report is sent only after opt-in survives a relaunch', async () => {
  const off = 'taalcut-e2e-crash-off';
  const reported = await page.evaluate(async (message) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.crashes.report({ kind: 'error', message }).then(
      () => 'ok',
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    );
  }, off);
  expect(reported).toBe('ok');
  await page.waitForTimeout(500);
  expect(ingest.bodies.some((body) => body.includes(off))).toBe(false);

  const enabled = await page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.commands
      .dispatch({ name: 'privacy.setCrashReports', payload: { enabled: true } })
      .then(
        () => 'ok',
        (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
      );
  });
  expect(enabled).toBe('ok');
  await expect.poll(() => readMirror(userData).crashReports).toBe(true);
  const stillOff = await page.evaluate(async (message) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.crashes.report({ kind: 'error', message }).then(
      () => 'ok',
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    );
  }, off);
  expect(stillOff).toBe('ok');
  await page.waitForTimeout(500);
  expect(ingest.bodies.some((body) => body.includes(off))).toBe(false);

  await app.close();
  await launchApp();
  expect(readMirror(userData).crashReports).toBe(true);
  const on = 'taalcut-e2e-crash-on';
  const again = await page.evaluate(async (message) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    return rpc.crashes.report({ kind: 'error', message }).then(
      () => 'ok',
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    );
  }, on);
  expect(again).toBe('ok');
  await expect.poll(() => ingest.bodies.some((body) => body.includes(on)), { timeout: 10_000 }).toBe(true);
});

function readMirror(dir: string): { crashReports?: boolean } {
  try {
    return JSON.parse(readFileSync(join(dir, 'privacy.json'), 'utf8')) as { crashReports?: boolean };
  } catch {
    return {};
  }
}

/** The gzip attachment payload inside a Sentry envelope, inflated to text. */
function gzipAttachment(body: Buffer): string {
  let offset = 0;
  const line = (): Buffer | undefined => {
    const nl = body.indexOf(0x0a, offset);
    if (nl < 0) return undefined;
    const slice = body.subarray(offset, nl);
    offset = nl + 1;
    return slice;
  };
  line();
  while (offset < body.length) {
    const headerLine = line();
    if (!headerLine || headerLine.length === 0) break;
    const header = JSON.parse(headerLine.toString('utf8')) as { length?: number; type?: string };
    const length = header.length ?? 0;
    const payload = body.subarray(offset, offset + length);
    offset += length;
    if (body[offset] === 0x0a) offset += 1;
    if (header.type === 'attachment') return gunzipSync(payload).toString('utf8');
  }
  throw new Error('feedback envelope has no attachment');
}
