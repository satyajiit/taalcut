// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Round P3-3 (G8): a web page opens in the browser through main (`files.openExternal`), never a new window: Add
// credit, Manage usage, a subscription's usage page, the beta terms and a provider's key page. A page off core's
// list is plain text, and a refused or failed call says so in a toast.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { accountsStateSchema, CHATGPT_PROVIDER, toRpcError, ValidationError } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackendProvider } from '../../src/backend/backend';
import { createFakeBackend } from '../../src/backend/fake/fake-backend';
import { BrowserLink } from '../../src/chat/external-link';
import { activateLocale } from '../../src/i18n/i18n';
import { freshMac, openWay, press } from '../onboarding/onboarding-dom';
import { expectOpenedThroughMain, OPEN_EXTERNAL, renderWatched, type Watch } from './spied-backend';

const OPEN = OPEN_EXTERNAL;
const CLAUDE_USAGE = 'https://claude.ai/settings/usage';

/** Clicks the link and expects exactly that page asked of main, with no new window. */
async function opens(name: string | RegExp, url: string, callsTo: (watch: Watch) => unknown[]) {
  const link = await screen.findByRole('link', { name }, { timeout: 3000 });
  expect(link.getAttribute('target')).toBe('_blank');
  await expectOpenedThroughMain(link, url, [{ url }], callsTo);
}

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value;

/** accounts.changed as main will send it: Claude's plan with its usage page (round P3-3's fixed table). */
async function* withClaudeUsagePage(source: unknown) {
  if (!isAsyncIterable(source)) return;
  for await (const raw of source) {
    const state = accountsStateSchema.parse(raw);
    yield {
      ...state,
      subscriptions: state.subscriptions.map((sub) =>
        sub.provider === 'anthropic' ? { ...sub, usageUrl: CLAUDE_USAGE } : sub,
      ),
    };
  }
}

describe('pages that open in the browser through main', () => {
  it('Settings › Usage: Add credit on a quota', async () => {
    const { callsTo } = await renderWatched('/settings/usage', OPEN, { phase3: { limits: 'three' } });
    await opens(/^Add credit/, 'https://platform.openai.com/settings/organization/billing', callsTo);
  });

  it('Settings › Usage: Manage usage for the ChatGPT plan', async () => {
    const { callsTo, controls } = await renderWatched('/settings/usage', OPEN);
    await act(async () => {
      await controls.accounts.signIn(CHATGPT_PROVIDER);
    });
    await opens(/^Manage usage/, 'https://chatgpt.com/codex/settings/usage', callsTo);
  });

  it('Settings › Usage: a subscription’s own usage page, when main knows it', async () => {
    const accounts: Watch = {
      namespace: 'accounts',
      procedure: 'changed',
      answer: async (_input, fake) => withClaudeUsagePage(await fake()),
    };
    const { callsTo, controls } = await renderWatched('/settings/usage', [OPEN, accounts]);
    await act(async () => {
      await controls.accounts.signIn('anthropic', Date.now());
    });
    await opens(/^Usage on Claude’s site/, CLAUDE_USAGE, callsTo);
    // With a page, the row links it instead of saying where its usage is.
    expect(screen.queryByText(/Its usage is on Claude’s own site/)).toBeNull();
  });

  it('first run: Read the beta terms', async () => {
    const fresh = freshMac();
    const { callsTo } = await renderWatched('/onboarding/beta', OPEN, {
      phase2b: fresh.phase2b,
      phase3: { updates: { channel: 'beta' } },
    });
    await opens(/^Read the beta terms/, 'https://taalcut.app/beta-terms/', callsTo);
  });

  it('first run: a provider’s key page', async () => {
    const fresh = freshMac();
    // UX4: the ways to think open from the last step's Kaatu moment when nothing can think yet.
    const { callsTo } = await renderWatched('/onboarding/first-video', OPEN, {
      phase2b: fresh.phase2b,
      phase3: fresh.phase3,
    });
    await press('[data-action="quiet-check-open"]');
    await openWay('api-key');
    await opens(/^Get a key from OpenAI/, 'https://platform.openai.com/api-keys', callsTo);
  });

  it('a refused page is a toast that says so', async () => {
    const refusing: Watch = {
      ...OPEN,
      answer: () => Promise.reject(toRpcError(ValidationError({ field: 'url' }))),
    };
    await renderWatched('/settings/usage', refusing, { phase3: { limits: 'three' } });
    const link = await screen.findByRole('link', { name: /^Add credit/ }, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(link);
    });
    expect(await screen.findByText('Couldn’t open that page')).toBeTruthy();
  });
});

describe('BrowserLink', () => {
  it('a page off core’s list is plain text, not a link', async () => {
    await activateLocale('en');
    const fake = createFakeBackend({ signInDelayMs: 0 });
    render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>
          <BrowserLink href="https://example.com/usage">Usage page</BrowserLink>
          <BrowserLink href="http://chatgpt.com/usage">Plain http</BrowserLink>
        </BackendProvider>
      </I18nProvider>,
    );
    expect(screen.getByText('Usage page').closest('a')).toBeNull();
    expect(screen.getByText('Plain http').closest('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
