// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the first-run specs share (P3-B3). Controls are found by their `data-*` hooks (`data-way` on a way's row,
 * `data-action` on the buttons that move first run on, `data-path` and `data-starter` on the opening choices), so
 * the same steps run in every language, the pseudo-locale included.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The locales a clean profile can start in: the four app languages and the pseudo-locale. */
export const FIRST_RUN_LOCALES = ['en', 'hi', 'es', 'pt-BR', 'en-XA'] as const;
export type FirstRunLocale = (typeof FIRST_RUN_LOCALES)[number];

export const action = (page: Page, name: string): Locator => page.locator(`[data-action="${name}"]`);

/** A way's row button (the ways to think and the sources). */
export const way = (page: Page, id: string): Locator => page.locator(`li[data-way="${id}"] > button`);

/** The open way's panel: under its row (the ways to think), or under the tiles (the sources step). */
export const panel = (page: Page, id: string): Locator =>
  page.locator(`li[data-way="${id}"] [role=region], [role=region][data-way-panel="${id}"]`);

/** Opens a way's row unless it is open already. */
export async function openWay(page: Page, id: string): Promise<void> {
  const row = way(page, id);
  await expect(row).toBeEnabled();
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await expect(panel(page, id)).toBeVisible();
}

/**
 * Opens the ways to think under the last step's Kaatu moment, unless a resume has them open already (a way chosen
 * last time opens them by itself).
 */
export async function openTheWays(page: Page): Promise<void> {
  const toggle = action(page, 'quiet-check-open');
  await expect(toggle).toBeVisible();
  await expect(page.locator('[data-slot=quiet-check-fix]')).toBeAttached();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Something can think, from the last step (UX4): Kaatu's moment opens the ways to connect, and ChatGPT signs in
 * through the browser. The moment goes once a way works.
 */
export async function connect(page: Page): Promise<void> {
  await openTheWays(page);
  await openWay(page, 'chatgpt');
  await action(page, 'chatgpt-sign-in').click();
  await expect(page.locator('[data-slot=quiet-check]')).toHaveCount(0);
}

/** Make my first video, once the last step says it may. */
export async function makeIt(page: Page): Promise<void> {
  const make = action(page, 'make-first-video');
  await expect(make).toBeEnabled({ timeout: 15_000 });
  await make.click();
}

/** Continue (or Agree and continue), once the step says it may. */
export async function carryOn(page: Page): Promise<void> {
  const next = action(page, 'continue');
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click();
}

export interface FakeProgress {
  readonly step: string | null;
  readonly completedAt: number | null;
  readonly completedVia: string | null;
  readonly branch: Record<string, unknown>;
}

/** First run's saved progress, as the agent keeps it (the fake's onboarding control). */
export const progress = (page: Page): Promise<FakeProgress> =>
  page.evaluate(() =>
    (
      window as unknown as { taalcutFake: { onboarding: { progress(): FakeProgress } } }
    ).taalcutFake.onboarding.progress(),
  );

/** The names of the commands the fake bus ran, oldest first (none while the page is still loading its fake). */
export const commandNames = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (
      (window as unknown as { taalcutFake?: { dispatched?: { name: string }[] } }).taalcutFake?.dispatched ??
      []
    ).map((each) => each.name),
  );

/** Waits until the bus has run a command with this name. */
export async function expectDispatched(page: Page, name: string): Promise<void> {
  await expect.poll(() => commandNames(page), { message: `${name} dispatched` }).toContain(name);
}

/** The step a first-run URL shows. */
export const atStep = (page: Page, step: string) =>
  expect(page).toHaveURL(new RegExp(`/onboarding/${step}$`));

/** Shared LIB2 flow, kept inside first run. */
export async function startImport(page: Page): Promise<void> {
  await action(page, 'import-connect').click();
  await page.locator('[data-item-index="0"]').click();
  await action(page, 'review-import').click();
  await expect(action(page, 'start-import')).toBeEnabled();
  await action(page, 'start-import').click();
}
