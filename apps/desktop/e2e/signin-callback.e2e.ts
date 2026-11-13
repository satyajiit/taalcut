// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: the page a ChatGPT sign-in's browser comes back to, in a real Chromium against the real loopback
 * server (no Electron, no network): one page per outcome in light and dark, each named in words, with no
 * request leaving the page and no CSP violation. Screenshots go to TAALCUT_CALLBACK_SCREENS when it is set
 * (the round's agt-out/screens), else to the test's output folder.
 *
 *   pnpm --filter @taalcut/desktop e2e:callback
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startLoopbackCallback, type CallbackOutcome, type LoopbackCallback } from '@taalcut/models';

const STATE = 'state-from-the-authorize-request';
const CODE = 'code-from-the-provider';

const HEADINGS: Readonly<Record<CallbackOutcome, string>> = {
  signed_in: 'You’re signed in',
  denied: 'Sign-in was declined',
  state_mismatch: 'This sign-in link is out of date',
  timeout: 'This sign-in timed out',
  exchange_failed: 'Sign-in didn’t finish',
  failed: 'Sign-in didn’t finish',
};

/** Starts a loopback wait and brings the browser back to it so that it ends with `outcome`. */
async function comeBack(page: Page, outcome: CallbackOutcome): Promise<LoopbackCallback> {
  const callback = await startLoopbackCallback({
    port: 0,
    path: '/auth/callback',
    expectedState: STATE,
    timeoutMs: outcome === 'timeout' ? 50 : 60_000,
    signal: new AbortController().signal,
    lateWindowMs: 60_000,
  });
  const url = (query: Record<string, string>) => `${callback.redirectUri}?${new URLSearchParams(query)}`;
  switch (outcome) {
    case 'signed_in':
    case 'exchange_failed': {
      // The browser waits on the page until the code has been exchanged (or not).
      const shown = page.goto(url({ code: CODE, state: STATE, client_id: 'issued-client' }));
      await callback.result;
      callback.respond(outcome);
      await shown;
      break;
    }
    case 'denied':
      await page.goto(url({ error: 'access_denied', state: STATE }));
      break;
    case 'state_mismatch':
      await page.goto(url({ code: CODE, state: 'from-an-older-sign-in' }));
      break;
    case 'timeout':
      await callback.result.catch(() => undefined);
      callback.release();
      await page.goto(url({ code: CODE, state: STATE }));
      break;
    case 'failed':
      await page.goto(url({ state: STATE }));
      break;
  }
  return callback;
}

for (const scheme of ['light', 'dark'] as const) {
  for (const outcome of Object.keys(HEADINGS) as CallbackOutcome[]) {
    test(`${outcome} in ${scheme}`, async ({ page }, info) => {
      await page.setViewportSize({ width: 960, height: 640 });
      await page.emulateMedia({ colorScheme: scheme });
      const requests: string[] = [];
      const violations: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      page.on('console', (message) => {
        if (/content security policy|refused to/i.test(message.text())) violations.push(message.text());
      });

      const callback = await comeBack(page, outcome);
      try {
        await expect(page.locator('h1')).toHaveText(HEADINGS[outcome]);
        await expect(page.getByRole('img', { name: 'Taalcut' })).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-outcome', outcome);
        // Nothing from the URL reaches the page.
        const text = await page.content();
        expect(text).not.toContain(CODE);
        expect(text).not.toContain(STATE);
        // The page is styled (its stylesheet passed the CSP) in the theme asked for.
        const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(background).not.toBe('rgba(0, 0, 0, 0)');
        expect(violations).toEqual([]);
        expect(requests.every((url) => url.startsWith('http://127.0.0.1:'))).toBe(true);

        const dir = process.env.TAALCUT_CALLBACK_SCREENS ?? info.outputDir;
        await page.screenshot({ path: join(dir, `callback-${outcome}-${scheme}.png`), fullPage: true });
      } finally {
        await callback.close();
      }
    });
  }
}
