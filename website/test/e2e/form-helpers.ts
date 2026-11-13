// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** What the contact specs share: the emulator's address, its documents, and how to open the form. */

/** Set by `pnpm e2e:forms`; a plain `pnpm e2e` has none, and the emulator's tests skip. */
export const EMULATOR = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR;
const DOCS = `http://${EMULATOR}/v1/projects/demo-taalcut/databases/(default)/documents`;
/** The emulator's admin token: reads past the rules, which let nobody read. */
const OWNER = { Authorization: 'Bearer owner' };

export const unique = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export type Value = { stringValue?: string; nullValue?: null; timestampValue?: string };

/** Every document in a collection, read past the rules. */
export async function storedAll(request: APIRequestContext, collection: string) {
  const res = await request.get(`${DOCS}/${collection}`, { headers: OWNER });
  return ((await res.json()) as { documents?: { fields: Record<string, Value> }[] }).documents ?? [];
}

/** Opens a page and checks the build is the one the test expects (`data-forms`), so a wrong build fails. */
export async function open(page: Page, path: string, mode: 'emulator' | 'closed') {
  await page.goto(path);
  await expect(page.locator('[data-forms]').first()).toHaveAttribute('data-forms', mode);
}

export const contactForm = (page: Page) => page.locator('section[aria-labelledby="contact-form"]');
