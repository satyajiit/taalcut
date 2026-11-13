// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H5 "Done when": changing a module's model in Settings changes the next
// call, end to end in the built app. The backend driver makes "the next call";
// today it is the in-page fake, later the real one (see backend-driver.ts).
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { FAKE_OPTIONS_KEY, open, preferences } from './support.ts';

test.beforeEach(async ({ page }) => {
  await preferences(page, { locale: 'en', theme: 'light' });
});

// Accounts' views (UX4): what's connected first, then Keys, Subscriptions and Servers, each its own page.
const KEYS = { name: 'settings-accounts-keys', path: '/settings/accounts/keys' };
const SUBSCRIPTIONS = { name: 'settings-accounts-subscriptions', path: '/settings/accounts/subscriptions' };
const SERVERS = { name: 'settings-accounts-servers', path: '/settings/accounts/servers' };

test('changing a job’s model in Settings changes the next call, and Usage shows it', async ({ page }) => {
  // Only providers with a key or a sign-in can be picked: connect Anthropic first (Accounts › Keys).
  await open(page, KEYS);
  const keys = page.getByRole('region', { name: 'API keys' });
  const anthropic = keys.getByRole('listitem').filter({ has: page.getByText('Anthropic', { exact: true }) });
  await anthropic.getByRole('button', { name: 'Add key' }).click();
  await keys.getByLabel('Anthropic API key').fill('sk-ant-e2e-settings-key');
  await keys.getByRole('button', { name: 'Save key' }).click();
  await expect(anthropic.getByText('Saved, not tested')).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Models' }).click();
  expect(await backend.nextCall(page, 'agent')).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
  const before = (await backend.dispatched(page)).length;

  // Advanced is hidden until asked for (PRD 9.4).
  const advanced = page.getByRole('button', { name: 'Show jobs' });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.click();
  const agent = page.getByRole('region', { name: 'Agent' });
  await agent.getByLabel('Model').selectOption('anthropic/claude-sonnet-5-5');
  await expect(agent.getByText('You changed this')).toBeVisible();
  await agent.getByLabel('Thinking').selectOption('high');
  await expect(agent.getByLabel('Thinking')).toHaveValue('high');

  expect(await backend.nextCall(page, 'agent')).toEqual({
    module: 'agent',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    reasoning: 'high',
  });
  expect((await backend.dispatched(page)).slice(before).map((d) => d.source)).toEqual(['ui', 'ui']);

  // The call is in the cloud-call log, newest first: Usage › Requests.
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Usage' }).click();
  await page
    .locator('[data-slot=settings-views]')
    .getByRole('link', { name: 'Requests', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/usage\/requests/);
  const firstRow = page.getByRole('region', { name: 'Requests' }).locator('tbody tr').first();
  await expect(firstRow).toContainText('claude-sonnet-5-5');
  await expect(firstRow).toContainText('Anthropic');
});

test('switching profile is live: no restart, the next call uses it', async ({ page }) => {
  await open(page, { name: 'settings-models', path: '/settings/models' });
  // The choice shows at once while its command runs (aria-busy); the next call follows the command.
  const profiles = page.getByRole('radiogroup', { name: 'Profile' });
  // The profile of this Mac's models is "On this Mac"; "Local only" is Privacy's switch (UX1, M9).
  await page.getByRole('radio', { name: 'On this Mac' }).check();
  await expect(profiles).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('radio', { name: 'On this Mac' })).toBeChecked();
  const call = await backend.nextCall(page, 'agent');
  expect(call.provider).toBe('on-device');
  expect(call.model).toBe('qwen3.5-4b');
  await page.getByRole('button', { name: 'Use recommended' }).click();
  await expect(profiles).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('radio', { name: 'Everyday' })).toBeChecked();
  expect((await backend.nextCall(page, 'agent')).model).toBe('gpt-6.1-sol');
});

test('API keys are write-only: the key never comes back to the page', async ({ page }) => {
  const secret = 'sk-e2e-never-shown-123456';
  await open(page, KEYS);
  const keys = page.getByRole('region', { name: 'API keys' });
  await keys.getByRole('button', { name: 'Add key' }).first().click();
  await keys.getByLabel('OpenAI API key').fill(secret);
  await keys.getByRole('button', { name: 'Save key' }).click();
  await expect(keys.getByText('Saved, not tested')).toBeVisible();
  await keys.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(keys.getByText(/Works/)).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain(secret);
});

test('ChatGPT uses OpenAI’s words; Claude login waits behind the warning', async ({ page }) => {
  await open(page, SUBSCRIPTIONS);
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect(page.getByText('Using ChatGPT plan')).toBeVisible();
  await expect(page.getByRole('link', { name: /Manage usage/ })).toHaveAttribute('target', '_blank');

  await page.getByRole('button', { name: 'Sign in to Claude' }).click();
  const card = page.getByRole('region', { name: 'Using your Claude plan in Taalcut' });
  await expect(card).toContainText('every request tells Anthropic it comes from Claude Code');
  await expect(page.getByRole('button', { name: 'Sign out of Claude' })).toHaveCount(0);
  await card.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('button', { name: 'Sign out of Claude' })).toBeVisible();
});

test('the “Review the warning” fix opens that sign-in’s warning card from anywhere', async ({ page }) => {
  await open(page, { name: 'library', path: '/library' });
  const payload = { feature: 'signin.claude', termsVersion: '2026-10-12' };
  // settings.openSignInWarning emits a ui.action; the palette's chunk, which listens, may still be loading.
  await expect(async () => {
    expect(await backend.agentDispatch(page, 'settings.openSignInWarning', payload)).toBe(true);
    // Accounts sends a sign-in's warning to the view that has the sign-in: Subscriptions.
    await expect(page).toHaveURL(/\/settings\/accounts\/subscriptions\?warning=signin\.claude$/, {
      timeout: 500,
    });
  }).toPass();
  const card = page.getByRole('region', { name: 'Using your Claude plan in Taalcut' });
  await expect(card).toBeVisible();
  await expect(page.getByRole('region', { name: /Using your GitHub Copilot plan/ })).toHaveCount(0);
});

test('the “Open Accounts” and “Open Models” fixes on a model’s error open those pages', async ({ page }) => {
  await open(page, { name: 'library', path: '/library' });
  // An error card dispatches its fix with an empty payload (fix-command.ts); these emit a ui.action, as above.
  for (const [command, url] of [
    ['settings.openAccounts', /\/settings\/accounts$/],
    ['settings.openModels', /\/settings\/models$/],
  ] as const) {
    await expect(async () => {
      expect(await backend.agentDispatch(page, command, {})).toBe(true);
      await expect(page).toHaveURL(url, { timeout: 500 });
    }).toPass();
  }
  await expect(page.getByText('That is no longer here')).toHaveCount(0);
});

test('a bring-your-own server is optional, a view of its own under Accounts', async ({ page }) => {
  // Not on Accounts' first view: most people never open Servers.
  await open(page, { name: 'settings-accounts', path: '/settings/accounts' });
  await expect(page.getByLabel('Ollama address')).toHaveCount(0);
  await page
    .locator('[data-slot=settings-views]')
    .getByRole('link', { name: 'Servers', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/accounts\/servers$/);
  await page.getByLabel('Ollama address').fill('http://localhost:11434');
  await page.getByRole('button', { name: 'Use this server' }).first().click();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText(/Connected\. 3 models are ready\./)).toBeVisible();
});

test('a server address with a user name or password is refused, under the field', async ({ page }) => {
  await open(page, SERVERS);
  const field = page.getByLabel('Ollama address');
  await field.fill('http://me:hunter2@localhost:11434');
  await page.getByRole('button', { name: 'Use this server' }).first().click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(/doesn’t keep passwords in server addresses/);
  await expect(page.getByRole('button', { name: 'Check connection' })).toHaveCount(0);
});

test('This Mac shows the hardware tier, the GPU and what each local job runs on', async ({ page }) => {
  await open(page, { name: 'settings-this-mac', path: '/settings/this-mac' });
  await expect(page.getByRole('region', { name: 'Hardware' })).toBeVisible();
  await expect(page.getByText('Recommended tier')).toBeVisible();
  await expect(page.getByText('16-core GPU')).toBeVisible();
  const compute = page.getByRole('region', { name: 'Where work runs on this Mac' });
  await expect(compute.getByText('GPU (Metal)').first()).toBeVisible();
  await expect(compute.getByText('This model has no GPU version yet.')).toBeVisible();
});

test('Settings is its own route with left-side tabs, and only the open tab is current', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await open(page, { name: 'settings-models', path: '/settings/models' });
  const sections = page.getByRole('navigation', { name: 'Settings' });
  await expect(sections.getByRole('link', { name: 'Models' })).toHaveAttribute('aria-current', 'page');
  await expect(sections.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Back to app' }),
  ).toBeVisible();
  // Opened in a 960 × 600 window, with the group headings and the words, the sections are taller than their box:
  // the list scrolls on its own and its bottom edge fades while more is below (shell/scroll-hint.ts), until
  // External agents, the last, is scrolled into view. (Folded to the rail they fit: the next test.)
  await page.locator('[data-slot=window-bar]').getByRole('button', { name: 'Sidebar' }).click();
  await expect(sections.getByRole('heading', { name: 'Connections' })).toBeVisible();
  await expect(sections).toHaveAttribute('data-more', 'true');
  await sections.getByRole('link', { name: 'External agents' }).scrollIntoViewIfNeeded();
  await expect(sections).toHaveAttribute('data-more', 'false');
  await expect(sections.getByRole('link', { name: 'External agents' })).toBeInViewport();
});

/**
 * Settings' sections (shell/settings-sections.ts, UX4): General alone (it stands for Updates, This Mac and About),
 * Your work three, AI and privacy four, Connections two; a hairline between each two groups on the rail.
 */
const SETTINGS_LINKS = 10;
const GROUP_RULES = 3;

/** Every section's link lies whole inside the list's own box, and the list has nothing to scroll. */
async function expectRailFits(page: Page, where: string) {
  const sections = page.getByRole('navigation', { name: 'Settings' });
  const fit = await sections.evaluate((nav) => {
    const box = nav.getBoundingClientRect();
    const outside = [...nav.querySelectorAll('a')]
      .filter((link) => {
        const each = link.getBoundingClientRect();
        return each.top < box.top - 0.5 || each.bottom > box.bottom + 0.5;
      })
      .map((link) => link.textContent);
    return {
      links: nav.querySelectorAll('a').length,
      outside,
      scrolls: nav.scrollHeight > nav.clientHeight + 1,
    };
  });
  expect(fit, where).toEqual({ links: SETTINGS_LINKS, outside: [], scrolls: false });
  // The group headings take no room on the rail; a hairline stands between the groups instead.
  for (const heading of await sections.locator('h2').all()) await expect(heading, where).toBeHidden();
  await expect(sections.locator('[data-group-rule]'), where).toHaveCount(GROUP_RULES);
}

// Settings lane's request to nav (specs/requests-settings-to-nav.md): at the smallest windows the rail lists all
// ten sections, External agents (the last) included, on a page at the top of the list and on one General stands for.
for (const theme of ['light', 'dark'] as const) {
  test(`the rail fits all ten sections at 1024 × 720 and at 960 × 600 (${theme})`, async ({ page }) => {
    await preferences(page, { theme });
    for (const [width, height] of [
      [1024, 720],
      [960, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const section of ['sources', 'about', 'external-agents'] as const) {
        await open(page, { name: `settings-${section}`, path: `/settings/${section}` });
        await expect(page.locator('[data-slot=sidebar][data-rail]')).toBeVisible();
        await expectRailFits(page, `${section} at ${width} × ${height}`);
      }
    }
  });
}

test('folded by hand and opened again, the group headings go and come back', async ({ page }) => {
  await open(page, { name: 'settings-about', path: '/settings/about' });
  const sections = page.getByRole('navigation', { name: 'Settings' });
  const toggle = page.locator('[data-slot=window-bar]').getByRole('button', { name: 'Sidebar' });
  // General leads with no heading of its own; the other three groups are named.
  await expect(sections.locator('h2')).toHaveText(['Your work', 'AI and privacy', 'Connections']);
  await toggle.click();
  await expect(page.locator('[data-slot=sidebar][data-rail]')).toBeVisible();
  await expectRailFits(page, 'folded at 1280 × 800');
  await toggle.click();
  await expect(sections.getByRole('heading', { name: 'AI and privacy' })).toBeVisible();
  await expect(sections.locator('[data-group-rule]')).toHaveCount(0);
});

test('at 960 × 600 a section below the fold is brought into view when it is the open one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await open(page, { name: 'settings-external-agents', path: '/settings/external-agents' });
  const last = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'External agents' });
  await expect(last).toHaveAttribute('aria-current', 'page');
  await expect(last).toBeInViewport();
});

test('General’s row stays current on the pages it stands for: Updates, This Mac and About', async ({
  page,
}) => {
  const sections = page.getByRole('navigation', { name: 'Settings' });
  for (const path of ['/settings/general', '/settings/updates', '/settings/this-mac', '/settings/about']) {
    await open(page, { name: 'settings-general', path });
    await expect(sections.getByRole('link', { name: 'General' }), path).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
});

test('General: Show Kaatu off hides the companion, and Show tips again is there', async ({ page }) => {
  await open(page, { name: 'settings-general', path: '/settings/general' });
  const show = page.locator('[data-setting=show-kaatu]').getByRole('switch', { name: 'Show Kaatu' });
  await expect(show).toHaveAttribute('aria-checked', 'true');
  // The words are the switch's hit area, as on macOS.
  await page.locator('[data-setting=show-kaatu]').getByText('Show Kaatu', { exact: true }).click();
  await expect(show).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.locator('[data-setting=tips]').getByRole('button', { name: 'Show tips again' }),
  ).toBeVisible();
  await page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Back to app' }).click();
  await expect(page.getByRole('navigation', { name: 'Areas' })).toBeVisible();
  await expect(page.locator('[data-slot=companion]')).toHaveCount(0);
});

test('old addresses still land: About’s Language on General, Models’ downloads on Downloads', async ({
  page,
}) => {
  await open(page, { name: 'settings-general', path: '/settings/about#language' });
  await expect(page).toHaveURL(/\/settings\/general#language$/);
  await expect(page.getByRole('radiogroup', { name: 'Language' })).toBeVisible();
  await open(page, { name: 'settings-models-downloads', path: '/settings/models#downloads' });
  await expect(page).toHaveURL(/\/settings\/models\/downloads#downloads$/);
  await expect(page.getByRole('region', { name: 'Models for this Mac' })).toBeVisible();
});

test('Privacy lists what is sent without asking; Revoke is immediate, with a plain line', async ({
  page,
}) => {
  await open(page, { name: 'settings-privacy', path: '/settings/privacy' });
  const list = page.getByRole('list', { name: 'Steps that send files without asking' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await list.getByRole('button', { name: 'Revoke “Seeing your clips”' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'will ask again' })).toHaveText(
    '“Seeing your clips” will ask again before sending files.',
  );
  await expect(list.getByRole('listitem')).toHaveCount(1);
});

/** The fakes' options before the app starts (src/backend/fake/expose.ts reads them). */
const fakeOptions = (page: Page, options: Record<string, unknown>) =>
  page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify(options),
  });

const SOURCES = { name: 'settings-sources', path: '/settings/sources' };

// UX1 W2-2: Sources on the library contract, not a stub.
test.describe('Settings › Sources', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the folders with their state, the phone as a link to the Library; Add folder and Remove (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { locale: 'en', theme });
      await fakeOptions(page, { pickedFolder: '/Users/me/Movies/Weekend in Lisbon', indexingTickMs: 0 });
      await open(page, SOURCES);
      const folders = page.getByRole('list', { name: 'Folders' });
      await expect(folders.getByRole('listitem')).toHaveCount(3);
      await expect(folders.locator('[data-status=offline]')).toContainText('The drive isn’t connected.');
      // What came from phones lives in Library › From your phone: Settings says how much and goes there.
      const phone = page.locator('[data-slot=sources-phone]');
      await expect(phone).toContainText('from your phone');
      await expect(phone.getByRole('link')).toHaveAttribute('href', '/library/imports?phones=true');
      await expectAccessible(page, testInfo, `sources (${theme})`);

      await folders.getByRole('button', { name: 'Remove Desktop clips' }).click();
      await expect(folders.getByRole('listitem')).toHaveCount(2);
      await page.getByRole('link', { name: 'Add folder…' }).click();
      await expect(page).toHaveURL(/\/library\/import\/folder$/);
      expect((await backend.dispatched(page)).some((entry) => entry.name === 'imports.createDraft')).toBe(
        false,
      );
      await page.locator('[data-action=import-connect]').click();
      await expect(page.locator('[data-item-index="0"]')).toBeVisible();
    });
  }

  test('empty: Kaatu, one sentence and the still shape of the list', async ({ page }, testInfo) => {
    await fakeOptions(page, { library: 'empty', indexingTickMs: 0 });
    await open(page, SOURCES);
    await expect(page.getByRole('heading', { name: 'No folders yet' })).toBeVisible();
    await expect(page.locator('[data-slot=sources-empty] li')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Add folder…' })).toBeVisible();
    await expectAccessible(page, testInfo, 'sources empty (light)');
  });
});

test('Back to app lands focus in the page it returns to, not on the body', async ({ page }) => {
  await open(page, { name: 'library', path: '/library' });
  // ⌘, is the palette's item, bound once its chunk has arrived.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+Comma');
    await expect(page).toHaveURL(/\/settings\/general$/, { timeout: 500 });
  }).toPass();
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(page).toHaveURL(/\/library$/);
  // The app comes back new, with nothing to put focus back on (scroll memory has nothing): its main area takes it.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
});
