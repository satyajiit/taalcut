// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V4 (the window's part): Settings › External agents. The switch is the person's; connecting a session copies
// its setup through main, so the bearer reaches the clipboard and never the page; a level changes at once; a
// revoked session can't act and says so; a server that fails to start says why and offers Try again. Every
// state is axe-clean in light and dark, and clean in the pseudo-locale.
import { expect, test, type Page } from '@playwright/test';
import { open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, shoot } from './ui2b-support.ts';
import { commandNames } from './onboarding-support.ts';

const PAGE = { name: 'settings-external-agents', path: '/settings/external-agents' };

interface McpWindow {
  taalcutFake: {
    phase3: {
      mcp: {
        clipboard: { sessionId: string; format: string; text: string }[];
        watch: { get(): { sessions: { id: string; name: string; level: string; status: string }[] } };
      };
    };
  };
}

const clipboard = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as McpWindow).taalcutFake.phase3.mcp.clipboard.map((each) => each.text),
  );
const sessions = (page: Page) =>
  page.evaluate(() => (window as unknown as McpWindow).taalcutFake.phase3.mcp.watch.get().sessions);

/** No bearer anywhere in the page: text, attributes or values. */
async function expectNoToken(page: Page) {
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  expect(html).not.toMatch(/tcm_[A-Za-z0-9_-]{8,}/);
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('input, textarea')].map((el) => (el as HTMLInputElement).value),
  );
  for (const value of values) expect(value).not.toMatch(/tcm_/);
}

test('switch on, connect Claude Code: the setup goes to the clipboard, the key never to the page', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { mcp: 'off' });
  await open(page, PAGE);
  const enabled = page.getByRole('switch', { name: 'Let agents on this Mac use Taalcut' });
  await expect(enabled).toHaveAttribute('aria-checked', 'false');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/Listening on this Mac only/)).toBeVisible();
  expect(await commandNames(page)).toContain('mcp.setEnabled');

  await page.getByLabel('Name (optional)').fill('Claude Code on my Mac');
  await page.getByRole('button', { name: 'Connect and copy setup' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Copied/ })).toBeVisible();
  const copied = await clipboard(page);
  expect(copied).toHaveLength(1);
  // The stdio setup is the default (security review SB-34): the key goes in the shim's environment.
  expect(copied[0]).toMatch(/TAALCUT_MCP_TOKEN=tcm_/);
  await expect(page.getByText('Taalcut clears it from the clipboard after two minutes')).toBeVisible();
  await expect(page.getByText('Claude Code on my Mac').filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'What Claude Code on my Mac may do' })).toBeVisible();
  await expectNoToken(page);
});

test('a session offers the stdio setup first, and says when HTTP suits and what cures a leaked key', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { mcp: 'sessions' });
  await open(page, PAGE);
  await expect(
    page.getByText('If a key may have leaked, Revoke access stops it at once, or New key replaces it.'),
  ).toBeVisible();
  await expect(page.getByText(/Copy HTTP setup suits a Mac with one user account/)).toBeVisible();
  const row = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Revoke access' }) });
  const copies = row.first().getByRole('button', { name: /^Copy/ });
  await expect(copies).toHaveText(['Copy setup', 'Copy HTTP setup']);
  await copies.nth(1).click();
  await expect
    .poll(async () => (await clipboard(page)).at(-1))
    .toMatch(/Authorization: Bearer tcm_|bearer_token/);
  await expectNoToken(page);
});

test('a level changes at once; revoke is immediate and says so', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { mcp: 'sessions' });
  await open(page, PAGE);
  const first = (await sessions(page)).find((each) => each.status !== 'revoked');
  expect(first).toBeDefined();
  const name = first?.name ?? '';
  const level = page.getByRole('radiogroup', { name: `What ${name} may do` });
  await level.getByRole('radio', { name: 'Edit and export' }).click();
  await expect.poll(async () => (await sessions(page)).find((s) => s.name === name)?.level).toBe('export');

  await page.getByRole('button', { name: 'Revoke access' }).first().click();
  await expect(page.getByText('Revoked. It can’t act any more.')).toBeVisible();
  await expect.poll(async () => (await sessions(page)).find((s) => s.name === name)?.status).toBe('revoked');
  expect(await commandNames(page)).toEqual(
    expect.arrayContaining(['mcp.setSessionLevel', 'mcp.revokeSession']),
  );
  await expectNoToken(page);
});

test('the server failing to start says why and offers Try again', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { mcp: 'error' });
  await open(page, PAGE);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`every state in ${theme}: accessible`, async ({ page }, testInfo) => {
    for (const mcp of ['off', 'on', 'sessions', 'error'] as const) {
      await preferences(page, { theme, locale: 'en' });
      await fakes(page, { mcp });
      await open(page, PAGE);
      await expectAccessible(page, testInfo, `external agents ${mcp} (${theme})`);
      await shoot(page, `external-agents-${mcp}-${theme}`);
    }
  });
}

test('the pseudo-locale: every state translated, nothing clipped', async ({ page }) => {
  for (const mcp of ['off', 'on', 'sessions', 'error'] as const) {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakes(page, { mcp });
    await open(page, PAGE);
    await expectPseudoClean(page, `external agents ${mcp}`);
  }
});
