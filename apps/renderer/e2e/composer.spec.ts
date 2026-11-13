// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The composer's model and thinking buttons (DESIGN A16, A17). The model is the
// agent's, one setting for every chat, switched with the same command as
// Settings → Models (so it is live and undoable); the thinking level belongs to
// the chat and comes back with it, from the run log.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { fakeChat, open, preferences } from './support.ts';

async function ask(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(text);
  await box.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await preferences(page, { locale: 'en', theme: 'light' });
});

test('the composer switches the agent’s model for every chat, and the thinking level per chat', async ({
  page,
}) => {
  await fakeChat(page, { latencyMs: 50, speed: 3 });
  // Connect Anthropic in Settings › Accounts › Keys: its models join the menu.
  await open(page, { name: 'settings-accounts-keys', path: '/settings/accounts/keys' });
  const keys = page.getByRole('region', { name: 'API keys' });
  const anthropic = keys.getByRole('listitem').filter({ has: page.getByText('Anthropic', { exact: true }) });
  await anthropic.getByRole('button', { name: 'Add key' }).click();
  await keys.getByLabel('Anthropic API key').fill('sk-ant-e2e-composer-key');
  await keys.getByRole('button', { name: 'Save key' }).click();
  await expect(anthropic.getByText('Saved, not tested')).toBeVisible();

  const chats = page.getByRole('navigation', { name: 'Chats' });
  // Settings is its own route, without the app's sidebar: back to the app first.
  await page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Back to app' }).click();
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Agent' }).click();
  await chats.getByRole('link', { name: /Trip to Goa reel/ }).click();
  const model = page.getByRole('button', { name: /^Model:/ });
  const thinking = page.getByRole('button', { name: /^Thinking:/ });
  await expect(model).toHaveText(/GPT-6\.1 Sol\s*OpenAI/);
  // The level this chat last sent with comes back with it.
  await expect(thinking).toHaveText(/High/);

  await model.click();
  const menu = page.getByRole('listbox', { name: 'Models' });
  await expect(menu.getByRole('group', { name: 'Anthropic' })).toBeVisible();
  await menu.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await expect(model).toHaveText(/Claude Sonnet 5\.5\s*Anthropic/);
  // Live: the next call uses it, through the same command as Settings, with no reload.
  expect(await backend.nextCall(page, 'agent')).toMatchObject({
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
  });
  expect((await backend.dispatched(page)).at(-1)).toEqual({
    name: 'models.setModuleOverride',
    source: 'ui',
  });

  // From the keyboard: open, End for the deepest level, Escape back to the button.
  await thinking.focus();
  await page.keyboard.press('Enter');
  const slider = page.getByRole('slider', { name: 'Thinking' });
  await expect(slider).toBeFocused();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Max');
  await page.keyboard.press('Escape');
  await expect(thinking).toBeFocused();
  await expect(thinking).toHaveText(/Max/);
  await ask(page, 'Shorter, please.');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 15_000 });

  // Another chat: the same model (one setting), its own level (the model's own: Medium).
  await chats.getByRole('link', { name: /Diwali highlights/ }).click();
  await expect(model).toHaveText(/Claude Sonnet 5\.5/);
  await expect(thinking).toHaveText(/Medium/);
  // Back: the level the last message went with.
  await chats.getByRole('link', { name: /Trip to Goa reel/ }).click();
  await expect(thinking).toHaveText(/Max/);

  // Undo (⌘K) puts the model back for every chat.
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Commands' });
  const undo = palette.locator('[role=option][data-command="edit.undo"]');
  await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
  await expect(undo).toContainText('Undo “Choose a model for a job”');
  await undo.click();
  await expect(model).toHaveText(/GPT-6\.1 Sol/);
  expect(await backend.nextCall(page, 'agent')).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
});
