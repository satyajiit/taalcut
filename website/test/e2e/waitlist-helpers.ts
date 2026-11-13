// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** What the waitlist and contact specs share: the emulator's address, its documents, and how to open a form. */

/** Set by `pnpm e2e:waitlist`; a plain `pnpm e2e` has none, and the emulator's tests skip. */
export const EMULATOR = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR;
const DOCS = `http://${EMULATOR}/v1/projects/demo-taalcut/databases/(default)/documents`;
/** The emulator's admin token: reads past the rules, which let nobody read. */
const OWNER = { Authorization: 'Bearer owner' };

export const unique = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export type Value = {
  stringValue?: string;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: Value[] };
};

/** A stored document's fields, read past the rules; null when there is none. */
export async function stored(request: APIRequestContext, path: string): Promise<Record<string, Value> | null> {
  const res = await request.get(`${DOCS}/${path}`, { headers: OWNER });
  if (res.status() === 404) return null;
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { fields: Record<string, Value> }).fields;
}

/** Every document in a collection, read past the rules. */
export async function storedAll(request: APIRequestContext, collection: string) {
  const res = await request.get(`${DOCS}/${collection}`, { headers: OWNER });
  return ((await res.json()) as { documents?: { fields: Record<string, Value> }[] }).documents ?? [];
}

export const strings = (v: Value | undefined) => (v?.arrayValue?.values ?? []).map((x) => x.stringValue);

/** Opens a page and checks the build is the one the test expects (`data-waitlist`), so a wrong build fails. */
export async function open(page: Page, path: string, mode: 'emulator' | 'closed') {
  await page.goto(path);
  await expect(page.locator('[data-waitlist]').first()).toHaveAttribute('data-waitlist', mode);
}

/** A form's status line (form-parts StatusLine): a problem, a failure or offline. */
export const STATUS_LINE = '[data-tone="error"], [data-tone="offline"]';

export const pageForm = (page: Page) => page.locator('main [data-variant="page"]');
export const contactForm = (page: Page) => page.locator('section[aria-labelledby="contact-form"]');
export const heroForm = (page: Page) => page.locator('section[aria-labelledby="home-title"]');
export const band = (page: Page, source: string) => page.locator(`section[aria-labelledby="band-${source}"]`);
export const success = (page: Page) => page.getByRole('status').filter({ hasText: 'You’re on the list.' });

/**
 * Where an element sits in the page's layout, so a test can say it didn't move. Layout offsets, not the painted box:
 * a block that is still rising into place on arrival (a transform) hasn't moved.
 */
export const top = (locator: Locator) =>
  locator.evaluate((el) => {
    let y = 0;
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
    return y;
  });
