// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { PAGES } from '../../src/content/pages';

/**
 * Every page's content is visible without JavaScript: the server HTML never holds an inline `opacity: 0`. A layer
 * that must rest unseen (a scan, a playhead, a ripple) mounts once its run starts in the browser, or hides through a
 * class; content starts visible and animates from there.
 */

const INLINE_ZERO = /opacity:\s*0[;"]/g;

/** The tag around each match, so a failure names the element, not only the page. */
function offenders(html: string): string[] {
  return [...html.matchAll(INLINE_ZERO)].map((match) => {
    const open = html.lastIndexOf('<', match.index);
    return html.slice(open, Math.min(html.length, match.index + 40)).replace(/\s+/g, ' ');
  });
}

for (const entry of PAGES) {
  test(`${entry.path} holds no inline opacity: 0 in its server HTML`, async ({ request }) => {
    const response = await request.get(entry.path);
    expect(response.status()).toBe(200);
    expect(offenders(await response.text())).toEqual([]);
  });
}
