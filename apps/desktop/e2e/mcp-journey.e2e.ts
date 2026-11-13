// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Security review SB-36: an external agent's export, approved by a person in the real window. The test build with
 * the real renderer on the make flow's recorded model session (make-flow.e2e.ts): the person's reference-driven
 * journey runs up to its one approval (taking the gapFix card's proposals when its cast asks, FIX-ASK), which leaves a
 * project whose reviewed timeline has a QA-checked draft. Then
 * the external side runs for real: External agents turned on (main starts the mcp process), a session made from
 * the window at level export (main mints the bearer and copies the setup text, read here from main's clipboard
 * with the Mac's clipboard put back), and a plain MCP client over HTTP with that bearer (mcp-wire.ts), on the
 * agent's external runner.
 *
 * - `render_export` waits for the person: the agent's ToolPolicy holds the checkpoint call (autonomy "Only before
 *   render"), and its export card goes to the session's own conversation, named after the session. Export on the
 *   card's review page (UX4, review-page.ts) lets the held call run: the client gets the render, and the audit log
 *   has the command from source `mcp`, actor `mcp:<sessionId>`.
 * - A second export (superseding the first), answered Not now: the client hears `declined`, and nothing renders.
 * - Revoked, the bearer is refused, for a new protocol session and the open one.
 *
 * The gapFix question is the make flow's, asked in the person's own run. An MCP session's run has no flow (kind
 * `external`, no model loop), so nothing there waits on it: the client lists a timeline's gaps with `timeline_gaps` and
 * fixes them with `timeline_fillGap`, `timeline_dropSlot` or `timeline_markForFilming`, which the client step checks
 * are listed and answer.
 *
 * The app keeps the make flow's stand-in HOME throughout: the vault, which keeps the session's
 * bearer, uses the mock keychain every e2e launch gets (launch.ts). The export card itself doesn't
 * name the session: render.export keeps its own card, which has no requester line (agent
 * external-policy.ts `withRequesterCard`); the conversation it sits in does.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { MAKE_FLOW_REFERENCE, referenceAsk } from '@taalcut/gate-demo';
import { createBinaryResolver } from '@taalcut/media';
import { findFreeLoopbackPort } from '@taalcut/models/node';
import { z } from 'zod';
import { takeGapProposals } from './gap-card';
import { installAppClient, launchApp, SEND_OFF_HEADING } from './gate-support';
import { libraryRows } from './library-rows';
import { shellAvailable } from './headless-shell';
import { makeFlowEnv, makeFlowHome, type MakeFlowHome } from './make-flow-support';
import { closeOrKill, within } from './mcp-journey-support';
import { chatList } from './sidebar';
import { mcpWire, type McpWire } from './mcp-wire';
import { dispatchAsPerson } from './probe-commands';
import { approvalAsks, exportOnReview, notNowOnReview } from './review-page';

const ffmpeg = await createBinaryResolver({ development: true }).resolve();
test.skip(!ffmpeg.ok, `no FFmpeg build (${ffmpeg.ok ? '' : ffmpeg.error.code}): run tools/ffmpeg/build.sh`);
test.skip(!shellAvailable(), "no chrome-headless-shell: run e2e:provision, or render's tests once");

const FLOW_MS = Number(process.env.TAALCUT_E2E_FLOW_MS ?? 600_000);
const SESSION = 'Claude Code on this Mac';

let app: ElectronApplication;
let page: Page;
let root: string;
let world: MakeFlowHome;
let wire: McpWire;
let sessionId = '';
let target: { projectId: string; timelineId: string; timelineRevision: number } | undefined;
let exportedId = '';

test.describe.configure({ mode: 'serial' });

/** Rows from the library while the app runs, checked against `schema`. */
function rows<T>(schema: z.ZodType<T>, sql: string, ...params: string[]): T[] {
  return z.array(schema).parse(libraryRows(world.userData, sql, ...params));
}
const renderCount = () => rows(z.object({ n: z.number() }), 'SELECT count(*) AS n FROM renders')[0]?.n;

const transcript = () => page.getByRole('main');
const composer = () => page.getByRole('textbox', { name: 'Message Taalcut' });
const card = (title: string) =>
  transcript()
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });

/** commands.dispatch through the probe client, as the person: 'ok' or the error code. */
function dispatch(name: string, payload: unknown): Promise<string> {
  return within(20_000, name, dispatchAsPerson(page, name, payload));
}

/** A session made from the window; its bearer read from the setup text main copied, the Mac's clipboard put back. */
async function createSession(): Promise<{ sessionId: string; bearer: string }> {
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const made = page.evaluate(async (name) => {
      const rpc = await window.taalcutProbe?.client;
      return rpc?.mcpSetup.createSession({
        name,
        client: 'claude-code',
        level: 'export',
        copy: 'claude-http',
      });
    }, SESSION);
    const created = await within(30_000, 'mcpSetup.createSession', made);
    const setup = await app.evaluate(({ clipboard }) => clipboard.readText());
    return {
      sessionId: created?.sessionId ?? '',
      bearer: /Bearer (tcm_[A-Za-z0-9_-]{43})/.exec(setup)?.[1] ?? '',
    };
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const binaries = ffmpeg.ok ? ffmpeg.value : undefined;
  if (!binaries) return;
  root = mkdtempSync(join('/tmp', 'taalcut-e2e-mcp-journey-'));
  world = await makeFlowHome(root, binaries);
  app = await launchApp(world.userData, makeFlowEnv(world.home));
  page = await app.firstWindow();
  await page.getByRole('link', { name: 'New chat' }).waitFor({ timeout: 60_000 });
});

test.afterAll(async () => {
  if (app && (await closeOrKill(app, 30_000)) === 'killed')
    console.warn("[mcp-journey] app.close() didn't finish in 30 s; killed");
  if (root) rmSync(root, { recursive: true, force: true });
});

test("the person's journey reaches its approval: a reviewed timeline with a QA-checked draft", async () => {
  test.setTimeout(FLOW_MS * 2);
  const text = referenceAsk(world.reels[MAKE_FLOW_REFERENCE] ?? '');
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  await composer().fill(text);
  await composer().press('Enter');
  // The reel's cast is unsure of two of its five clips: the person takes the gapFix card's proposals (FIX-ASK).
  await takeGapProposals(transcript(), FLOW_MS);
  // The reel's frames go without a consent card (FIX-CONSENT), each a logged approval.
  await approvalAsks(card('Ready to export').last(), FLOW_MS);
  await expect(card(SEND_OFF_HEADING)).toHaveCount(0);
  const [logged] = rows(
    z.object({ n: z.number() }),
    `SELECT count(*) AS n FROM agent_events
     WHERE type = 'approval.requested' AND payload LIKE '%"reference":true%'`,
  );
  expect(logged?.n).toBeGreaterThan(0);
  [target] = rows(
    z.object({ projectId: z.string(), timelineId: z.string(), timelineRevision: z.number() }),
    `SELECT project_id AS projectId, timeline_id AS timelineId, timeline_revision AS timelineRevision
     FROM renders WHERE status = 'ready' ORDER BY created_at DESC LIMIT 1`,
  );
  expect(target).toBeDefined();
});

test('External agents on, and a session at level export made from the window serves its bearer', async () => {
  test.setTimeout(240_000);
  const port = await findFreeLoopbackPort();
  // The probe client replaces the renderer's connection for these calls; the reload below restores it.
  await test.step('probe client', () => within(90_000, 'installAppClient', installAppClient(page)));
  await test.step('External agents on', async () => {
    expect(await dispatch('mcp.setPort', { port })).toBe('ok');
    expect(await dispatch('mcp.setEnabled', { enabled: true })).toBe('ok');
    const state = () =>
      within(
        5_000,
        'mcp.state',
        page.evaluate(async () => (await (await window.taalcutProbe?.client)?.mcp.state())?.server.state),
      );
    await expect.poll(state, { timeout: 20_000 }).toBe('listening');
  });
  const made = await test.step('session at level export', () => createSession());
  sessionId = made.sessionId;
  expect(sessionId).not.toBe('');
  expect(made.bearer).not.toBe('');
  await test.step('window back on its own connection', async () => {
    await page.reload();
    await page.getByRole('link', { name: 'New chat' }).waitFor({ timeout: 30_000 });
  });
  wire = mcpWire(port, made.bearer);
  await test.step('client', async () => {
    await within(20_000, 'initialize', wire.open());
    const tools = await within(20_000, 'tools/list', wire.tools());
    expect(tools).toContain('render_export');
    // A timeline's gaps are the client's to see and fix: no question in the app waits on an MCP session's run.
    expect(tools).toEqual(
      expect.arrayContaining([
        'timeline_gaps',
        'timeline_fillGap',
        'timeline_dropSlot',
        'timeline_markForFilming',
      ]),
    );
    const gaps = await within(
      20_000,
      'timeline_gaps',
      wire.call('timeline_gaps', { timelineId: target?.timelineId }),
    );
    expect(gaps.isError ?? false, JSON.stringify(gaps)).toBe(false);
    expect(gaps.structuredContent).toMatchObject({ gaps: expect.any(Array) });
  });
});

test('render_export waits for the person: Export on the review page in the session conversation runs it', async () => {
  test.setTimeout(FLOW_MS);
  expect(target).toBeDefined();
  const answer = wire.call('render_export', { ...target });
  const conversation = (await chatList(page)).getByRole('link', { name: SESSION });
  await conversation.click();
  // The person's own export card is on the page they leave: wait until the session's conversation is shown.
  await expect(conversation).toHaveAttribute('aria-current', 'page');
  await expect(transcript().getByRole('article').filter({ hasText: /^You:/ })).toHaveCount(0);
  const asking = card('Ready to export').last();
  // Within the gateway's 45 s hold: the call is still open when the person answers.
  await approvalAsks(asking, 30_000);
  await exportOnReview(page, asking, 30_000);
  const result = await answer;
  expect(result.isError ?? false, JSON.stringify(result)).toBe(false);
  const done = z
    .object({ render: z.object({ id: z.string(), status: z.string() }) })
    .parse(result.structuredContent);
  expect(done.render.status).toBe('ready');
  exportedId = done.render.id;
  await expect(asking.getByRole('status').filter({ hasText: 'Exported' })).toBeVisible({ timeout: 30_000 });
  const audit = rows(
    z.object({ name: z.string(), source: z.string(), actor: z.string() }),
    'SELECT name, source, actor FROM commands WHERE actor = ? ORDER BY seq',
    `mcp:${sessionId}`,
  );
  expect(audit).toContainEqual({ name: 'render.export', source: 'mcp', actor: `mcp:${sessionId}` });
  console.warn(`[mcp-journey] approved: ${JSON.stringify({ sessionId, render: done.render, audit })}`);
});

test('a second export answered Not now: the client hears declined, and nothing renders', async () => {
  const before = renderCount();
  const answer = wire.call('render_export', { ...target, supersedes: exportedId });
  await expect(card('Ready to export')).toHaveCount(2, { timeout: 30_000 });
  await notNowOnReview(page, card('Ready to export').last(), 30_000);
  const result = await answer;
  expect(result.isError, JSON.stringify(result)).toBe(true);
  expect(result.structuredContent).toMatchObject({ status: 'declined' });
  expect(renderCount()).toBe(before);
  console.warn(
    `[mcp-journey] declined: ${JSON.stringify({ answer: result.structuredContent, renders: before })}`,
  );
});

test('revoked from the window, the bearer is refused', async () => {
  test.setTimeout(150_000);
  await within(90_000, 'installAppClient', installAppClient(page));
  expect(await dispatch('mcp.revokeSession', { sessionId })).toBe('ok');
  await expect.poll(() => wire.initializeStatus(), { timeout: 5_000 }).toBe(401);
  expect(await wire.listStatus()).toBe(401);
});
