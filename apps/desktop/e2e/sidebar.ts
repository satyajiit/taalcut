// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sidebar and its chat list, reached the way a person reaches them, whatever the display.
 *
 * A window under 1100 px wide folds the sidebar to its icon rail by itself, and the rail has no chat list
 * (DESIGN.md, "Narrow window" and "Sidebar rail"; apps/renderer/src/shell/sidebar-state.ts). The window can't be
 * wider than the screen, so on a small display every window is narrow: on a 1024 × 768 display the app opens at
 * 1024 × 674, on the rail. A test that uses the chat list opens the sidebar with the
 * window bar's button first, as a person on that Mac would; on a wider display it is open already.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The window bar's sidebar button (`aria-expanded`, `aria-controls`). */
export const SIDEBAR_TOGGLE = '[data-slot=window-bar] button[aria-controls=app-sidebar]';

/** sidebar-state.ts's NARROW_WINDOW_QUERY: narrower than this, the window folds the sidebar to its rail. */
const NARROW_WINDOW_QUERY = '(max-width: 1099.98px)';

/** Whether the window is narrow enough that the app folds the sidebar to its rail by itself. */
export function isNarrowWindow(page: Page): Promise<boolean> {
  return page.evaluate((query) => window.matchMedia(query).matches, NARROW_WINDOW_QUERY);
}

/** Opens the sidebar with the window bar's button if it is on its rail; `timeout` waits for the shell first. */
export async function openSidebar(page: Page, timeout?: number): Promise<void> {
  const toggle = page.locator(SIDEBAR_TOGGLE);
  await toggle.waitFor(timeout === undefined ? {} : { timeout });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** The chat list (the agent process serves it), with the sidebar open; `timeout` waits for the shell and the list. */
export async function chatList(page: Page, timeout?: number): Promise<Locator> {
  await openSidebar(page, timeout);
  const list = page.getByRole('navigation', { name: 'Chats' });
  await list.waitFor(timeout === undefined ? {} : { timeout });
  return list;
}
