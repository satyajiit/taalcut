// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: the page the browser shows when a ChatGPT sign-in comes back to Taalcut. One page per outcome, the
 * lockup drawn inline, light and dark, every word from the catalogue, and nothing from the request: the
 * loopback tests check that no code, state or token reaches it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CALLBACK_OUTCOMES,
  CALLBACK_PAGE_CSP,
  callbackPage,
  callbackPageKeys,
  MODELS_MESSAGES_EN,
} from '@taalcut/models';

const t = (key: string) => MODELS_MESSAGES_EN[key] ?? `[missing ${key}]`;

const EXPECTED = {
  signed_in: ['You’re signed in', 'You can close this tab and return to Taalcut.'],
  denied: ['Sign-in was declined', 'ChatGPT didn’t give Taalcut access'],
  state_mismatch: ['This sign-in link is out of date', 'Taalcut ignored it'],
  timeout: ['This sign-in timed out', 'Taalcut stopped waiting'],
  exchange_failed: ['Sign-in didn’t finish', 'couldn’t get access from OpenAI'],
  failed: ['Sign-in didn’t finish', 'Something went wrong between ChatGPT and Taalcut'],
} as const;

describe('the sign-in callback page', () => {
  it.each(CALLBACK_OUTCOMES)('says plainly how it ended: %s', (outcome) => {
    const html = callbackPage(t, outcome);
    const [heading, sentence] = EXPECTED[outcome];
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html).toContain(sentence);
    expect(html).toContain(`data-outcome="${outcome}"`);
    expect(html).toContain('This page comes from Taalcut on this computer, not from a website.');
    for (const key of callbackPageKeys(outcome)) expect(MODELS_MESSAGES_EN[key], key).toBeTruthy();
    expect(html).not.toContain('[missing');
  });

  it('draws the Taalcut lockup inline: four colours when signed in, two otherwise', () => {
    const done = callbackPage(t, 'signed_in');
    const failed = callbackPage(t, 'denied');
    for (const html of [done, failed]) {
      expect(html).toMatch(/<svg class="lockup" viewBox="0 0 905 256" role="img" aria-label="Taalcut"/);
    }
    for (const tone of ['l1', 'l2', 'l3', 'l4']) expect(done).toContain(`class="${tone}"`);
    expect(failed).toContain('class="l1"');
    expect(failed).not.toMatch(/class="l[234]"/);
  });

  it('follows the system’s light or dark with the app’s colours', () => {
    const html = callbackPage(t, 'signed_in');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    // The canvas of each theme (design/tokens/tokens.css).
    expect(html).toContain('--canvas:oklch(97.5% 0.008 75)');
    expect(html).toContain('--canvas:oklch(18% 0.01 65)');
  });

  it('loads nothing, runs nothing, and applies only its own stylesheet', () => {
    const html = callbackPage(t, 'failed');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<form|@import|url\(/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(html).not.toMatch(/\sstyle="/);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    const hash = createHash('sha256').update(style, 'utf8').digest('base64');
    expect(CALLBACK_PAGE_CSP).toBe(
      `default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
  });

  it('escapes whatever the catalogue says and takes its language', () => {
    const html = callbackPage(() => '<b>"x"</b> & y', 'denied', 'hi');
    expect(html).toContain('<html lang="hi">');
    expect(html).toContain('&#60;b&#62;&#34;x&#34;&#60;/b&#62; &#38; y');
    expect(html).not.toContain('<b>');
  });
});
