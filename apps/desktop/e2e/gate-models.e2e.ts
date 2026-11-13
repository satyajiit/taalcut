// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 4 automated: the same chat runs on Continue with ChatGPT and
 * on an API-key provider, switched live in Settings, with no restart. The
 * test build starts with TAALCUT_TEST_MODEL_SERVERS, which points OpenAI and
 * Anthropic, and Sign in with ChatGPT's issuer, at @taalcut/models' mock
 * servers; everything else is the app (main's auth broker and keychain vault,
 * the agent process's ModelClient and profiles, the library).
 *
 * In the window: Settings → Accounts → Continue with ChatGPT (the test plays
 * the browser: it follows the URL the app opened to the mock issuer, which
 * redirects to the app's loopback callback), then a chat answered by the
 * ChatGPT mock. Settings → Accounts → an Anthropic key (write-only), Settings
 * → Models → the agent on Claude, and the same conversation's next message is
 * answered by the Anthropic mock. Undo from ⌘K puts the agent back on
 * ChatGPT. Then the composer itself switches the agent to Claude and its
 * thinking to Max, and the next call goes out with Claude's max effort. The
 * mocks only answer live ChatGPT tokens and the saved key.
 * Backing checks: CloudCall rows name both providers; neither the key nor
 * any ChatGPT token is in userData, the app's output or the renderer.
 */
import { readdirSync, readFileSync, realpathSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  startMockOAuthServer,
  startMockProviderServer,
  type MockOAuthServer,
  type MockProviderServer,
} from '@taalcut/models/test-support';
import { libraryPath } from '../src/shared/library-path';
import { StartupTimeline } from './gate-support';
import { launchElectron } from './launch';
import { chatList } from './sidebar';
import { MODEL_SERVERS_ENV } from '../src/shared/test-model-servers';

const ANTHROPIC_KEY = 'sk-ant-e2e-gate-models-0123456789abcdef';
const CHATGPT_REPLY = 'Hello from the mock openai server.';
/** The chat's name: the model's reply to the title request after the first exchange, tidied (no full stop). */
const CHAT_TITLE = 'Hello from the mock openai server';
const ANTHROPIC_REPLY = 'Hello from the mock anthropic server.';

let app: ElectronApplication;
let page: Page;
let root: string;
let userData: string;
let oauth: MockOAuthServer;
let providers: MockProviderServer;
let conversationId: string;
const output: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(150_000);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-e2e-models-')));
  userData = join(root, 'user-data');
  mkdirSync(join(root, 'home'));
  mkdirSync(userData);
  oauth = await startMockOAuthServer();
  providers = await startMockProviderServer();
  // Like the real APIs: OpenAI takes only live ChatGPT access tokens, Anthropic only the saved key.
  providers.setAuthCheck((headers) =>
    headers['x-api-key'] !== undefined
      ? headers['x-api-key'] === ANTHROPIC_KEY
      : oauth.isValidAccess(headers.authorization?.replace(/^Bearer /, '') ?? undefined),
  );
  const servers = {
    baseUrls: { openai: providers.openaiBaseUrl, anthropic: providers.anthropicBaseUrl },
    chatgpt: { authorizeUrl: oauth.authorizeUrl, tokenUrl: oauth.tokenUrl },
  };
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  const start = new StartupTimeline();
  app = await start.step('app launch', 60_000, () =>
    launchElectron(userData, {
      env: { ...inherited, HOME: join(root, 'home'), [MODEL_SERVERS_ENV]: JSON.stringify(servers) },
      timeout: 0,
    }),
  );
  start.listen(app);
  const keep = (chunk: Buffer) => void output.push(String(chunk));
  app.process().stdout?.on('data', keep);
  app.process().stderr?.on('data', keep);
  // The test plays the system browser: main's shell.openExternal records the URL instead of opening it.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { __taalcutOpened: opened });
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  page = await start.step('first window', 30_000, () => app.firstWindow());
  await start.step('main connection ready', 30_000, () =>
    page.getByRole('link', { name: 'New chat' }).waitFor(),
  );
  await start.step('agent ready', 30_000, () => chatList(page, 30_000));
});

test.afterAll(async () => {
  await app?.close();
  await Promise.all([oauth?.close(), providers?.close()]);
  rmSync(root, { recursive: true, force: true });
});

async function openSettings(section: 'Accounts' | 'Models'): Promise<void> {
  // From the app's sidebar; already in Settings (its own sidebar), straight to the section.
  if (!(await page.getByRole('navigation', { name: 'Settings' }).isVisible()))
    await page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: section }).click();
  await expect(page.getByRole('heading', { level: 1, name: section })).toBeVisible();
}

/** Settings has its own sidebar since the dedicated settings route: its Back to app returns to the app's. */
async function leaveSettings(): Promise<void> {
  const back = page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Back to app' });
  if (await back.isVisible()) await back.click();
}

async function backToConversation(): Promise<void> {
  await leaveSettings();
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Agent' }).click();
  // The recent chats list names each chat (and its time): by the title the model gave it after the first exchange.
  await (await chatList(page)).getByRole('link', { name: CHAT_TITLE }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`));
}

/** Message roles exclude the operation and cost cards that also render as articles. */
const userMessages = () => page.getByRole('main').locator('[data-slot=chat-message][data-role=user]');
const answers = () => page.getByRole('main').locator('[data-slot=chat-message][data-role=agent]');

/** URLs main asked the system browser to open. */
const openedUrls = () =>
  app.evaluate(() => (globalThis as { __taalcutOpened?: string[] }).__taalcutOpened ?? []);

/** Sends a message and waits for the answer: the conversation's `nth` agent message. */
async function ask(text: string, nth: number, reply: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(text);
  await box.press('Enter');
  await expect(answers()).toHaveCount(nth, { timeout: 30_000 });
  await expect(answers().last()).toContainText(reply, { timeout: 30_000 });
  await expect(answers().last()).not.toHaveAttribute('aria-busy', 'true');
}

test('Continue with ChatGPT signs in through the browser, and the chat runs on the plan', async () => {
  await openSettings('Accounts');
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect.poll(openedUrls).toHaveLength(1);
  const [url] = await openedUrls();
  // The browser: the issuer approves at once and redirects to the app's loopback callback.
  const authorize = await fetch(url!, { redirect: 'manual' });
  const callback = authorize.headers.get('location');
  expect(callback).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+\//);
  expect((await fetch(callback!)).status).toBe(200);
  await expect(page.getByText('Using ChatGPT plan')).toBeVisible();

  await leaveSettings();
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Agent' }).click();
  await page.getByRole('link', { name: 'New chat' }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
  conversationId = new URL(page.url()).pathname.split('/').at(-1)!;
  await ask('Which plan answers this?', 1, CHATGPT_REPLY);
  // After the first exchange the chat is named, through the same ModelClient (logged like any call).
  // The title call runs in the background after the reply, so allow for a busy machine.
  await expect.poll(() => storedTitle(conversationId), { timeout: 15_000 }).toBe(CHAT_TITLE);
});

/** A conversation's title, as the library stores it. */
function storedTitle(id: string): string | undefined {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    const row = db.prepare('SELECT title FROM conversations WHERE id = ?').get(id) as
      { title: string } | undefined;
    return row?.title;
  } finally {
    db.close();
  }
}

test('an Anthropic key and the agent switched to Claude: the same chat goes on, no restart', async () => {
  const pid = app.process().pid;
  await openSettings('Accounts');
  // Keys are a view of their own since UX4 (Connected, Keys, Subscriptions, Servers).
  await page.getByRole('navigation', { name: 'Accounts' }).getByRole('link', { name: 'Keys' }).click();
  // The API-key row labelled Anthropic (the Claude plan's sign-in row is another view).
  const keys = page.getByRole('region', { name: 'API keys' });
  const anthropic = keys.getByRole('listitem').filter({ has: page.getByText('Anthropic', { exact: true }) });
  await anthropic.getByRole('button', { name: 'Add key' }).click();
  await keys.getByLabel('Anthropic API key').fill(ANTHROPIC_KEY);
  await keys.getByRole('button', { name: 'Save key' }).click();
  await expect(anthropic.getByText('Saved, not tested')).toBeVisible();
  await expect(page.getByLabel('Anthropic API key')).toHaveCount(0);

  await openSettings('Models');
  await page.getByRole('button', { name: 'Show jobs' }).click();
  const agent = page.getByRole('region', { name: 'Agent', exact: true });
  await agent.getByLabel('Model').selectOption('anthropic/claude-sonnet-5-5');
  await expect(agent.getByText('You changed this')).toBeVisible();

  await backToConversation();
  await ask('And who answers now?', 2, ANTHROPIC_REPLY);
  // One conversation across the switch: the ChatGPT turn stays above Claude's, in the same chat.
  await expect(userMessages()).toHaveText([/Which plan answers this\?/, /And who answers now\?/]);
  await expect(answers().first()).toContainText(CHATGPT_REPLY);
  // Claude got the saved key (the mock refuses anything else), and the app never restarted.
  const claude = providers.requests.filter((r) => r.route === 'anthropic');
  expect(claude.at(-1)?.headers['x-api-key']).toBe(ANTHROPIC_KEY);
  expect(app.process().pid).toBe(pid);
  // Claude saw the conversation so far: the ChatGPT turn, the question and its answer, come before the new one.
  for (const request of claude) {
    const sent = JSON.stringify(request.body);
    expect(sent).toContain('Which plan answers this?');
    expect(sent).toContain(CHATGPT_REPLY);
    expect(sent.indexOf(CHATGPT_REPLY)).toBeLessThan(sent.indexOf('And who answers now?'));
  }
});

test('Undo from ⌘K puts the agent back on ChatGPT for the next message', async () => {
  await page.keyboard.press('ControlOrMeta+k');
  const search = page
    .getByRole('dialog', { name: 'Commands' })
    .getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await page.keyboard.type('Undo');
  await page.getByRole('option', { name: /^Undo “/ }).click();
  await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
  await ask('Back to the plan?', 3, CHATGPT_REPLY);
  // And ChatGPT, back on, sees Claude's turn.
  const sent = JSON.stringify(providers.requests.filter((r) => r.route === 'openai').at(-1)?.body);
  expect(sent).toContain('And who answers now?');
  expect(sent).toContain(ANTHROPIC_REPLY);
});

test('the composer switches the agent to Claude and thinks at Max: the next message goes out that way', async () => {
  const pid = app.process().pid;
  const model = page.getByRole('button', { name: /^Model:/ });
  const thinking = page.getByRole('button', { name: /^Thinking:/ });
  // The model menu lists the connected accounts' models, by provider; picking one is the Settings command.
  await model.click();
  const menu = page.getByRole('listbox', { name: 'Models' });
  await expect(menu.getByRole('group', { name: 'Anthropic' })).toBeVisible();
  await menu.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await expect(model).toContainText('Claude Sonnet 5.5');
  // Thinking, from the keyboard: Return opens it on the slider, End is the deepest level, Escape closes.
  await thinking.focus();
  await page.keyboard.press('Enter');
  const slider = page.getByRole('slider', { name: 'Thinking' });
  await expect(slider).toBeFocused();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Max');
  await page.keyboard.press('Escape');
  await expect(thinking).toContainText('Max');

  await ask('Think it through: who answers?', 4, ANTHROPIC_REPLY);
  // Claude was asked for its deepest thinking, with the saved key, and the app never restarted.
  const claude = providers.requests.filter((r) => r.route === 'anthropic').at(-1);
  expect(claude?.headers['x-api-key']).toBe(ANTHROPIC_KEY);
  const sent = JSON.stringify(claude?.body);
  expect(sent).toContain('thinking');
  expect(sent).toContain('"max"');
  expect(app.process().pid).toBe(pid);
  // The level is this chat's: it is still Max when the chat is opened again.
  await backToConversation();
  await expect(thinking).toContainText('Max');
  await expect(model).toContainText('Claude Sonnet 5.5');
});

test('backing checks: CloudCall rows name both providers; the key and tokens are nowhere', async () => {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  let calls: { module: string; provider: string; outcome: string; reasoning: string }[];
  try {
    calls = db
      .prepare(
        "SELECT module, provider, outcome, reasoning FROM cloud_calls WHERE module = 'agent' ORDER BY started_at",
      )
      .all() as typeof calls;
  } finally {
    db.close();
  }
  const order = calls.map((c) => c.provider).filter((p, i, all) => p !== all[i - 1]);
  expect(order).toEqual(['openai', 'anthropic', 'openai', 'anthropic']);
  expect(calls.every((c) => c.outcome === 'ok')).toBe(true);
  // The composer's Max went out as Claude's max (the log records the level each call was sent with).
  expect(calls.at(-1)?.reasoning).toBe('max');

  const secrets = [ANTHROPIC_KEY, ...oauth.secrets()];
  expect(oauth.issued.length).toBeGreaterThan(0);
  // userData: the library database (and its WAL), the vault (encrypted), Chromium's own files.
  const files = filesUnder(userData);
  expect(files).toEqual(
    expect.arrayContaining([libraryPath(userData), join(userData, 'vault', 'secrets.json')]),
  );
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const secret of secrets)
      expect(bytes.includes(secret), `${secret.slice(0, 6)}… in ${file}`).toBe(false);
  }
  const logs = output.join('');
  const renderer =
    (await page.content()) +
    (await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })));
  for (const secret of secrets) {
    expect(logs.includes(secret), `${secret.slice(0, 6)}… in the app's output`).toBe(false);
    expect(renderer.includes(secret), `${secret.slice(0, 6)}… in the renderer`).toBe(false);
  }
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}
