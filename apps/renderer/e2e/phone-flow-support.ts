// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// What the desktop phone flow's specs (phone-flow*.spec.ts) share: the fake transfer service's options, its
// server state, and the tabs. The phone's own page has phone-page-support.ts (phoneweb's).
import { expect, type Page } from '@playwright/test';
import type { RouteSample } from './routes.ts';
import { FAKE_OPTIONS_KEY, open } from './support.ts';

export const FLOW: RouteSample = {
  name: 'library-phone',
  path: '/library/phone',
  lands: '/library/import/phone-wifi',
};

export type PhoneTab = 'wifi' | 'cable' | 'transfers' | 'help';

export const tab = (name: PhoneTab): RouteSample => ({
  name: `library-phone-${name}`,
  path: `/library/phone/${name}`,
  lands:
    name === 'transfers'
      ? '/library/imports\\?phones=true'
      : name === 'help'
        ? '/library/import/phone-wifi/help'
        : `/library/import/phone-${name}`,
});

/**
 * The fake backend's options for this page load (src/backend/fake/expose.ts): `transfer` is the Wi-Fi
 * scenario, `transferSpeed`, `transferStartMs` (a slow start), `usb` the phone on a cable.
 */
export async function fakePhone(page: Page, options: Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ indexingTickMs: 0, ...options }),
  });
}

/** The fake Wi-Fi server's state (src/backend/fake/fake-transfer.ts). */
interface ServerState {
  listening: boolean;
  opens: number;
  closes: number;
  session: { stopReason?: string; devices: unknown[]; totals: { files: number; done: number } } | null;
  /** 'approval': the phone's request to pair, null until it asks (UX3). */
  approval: { state: string } | null;
}

interface FakeWindow {
  taalcutFake: { transfer: { state(): ServerState } };
}

export const server = (page: Page): Promise<ServerState> =>
  page.evaluate(() => {
    // Runs in the page: the guard is declared here, where it runs.
    const hasFake = (value: unknown): value is FakeWindow =>
      typeof value === 'object' && value !== null && 'taalcutFake' in value;
    if (!hasFake(window)) throw new Error('the fake backend is not on window');
    return window.taalcutFake.transfer.state();
  });

/** The listening band exists on the connection screen. */
export const band = (page: Page) => page.locator('[data-slot=listening]');

/** Legacy addresses redirect to the corresponding LIB2 screen without opening a connection. */
export async function onTab(page: Page, name: PhoneTab): Promise<void> {
  const path =
    name === 'transfers'
      ? '/library/imports\\?phones=true'
      : name === 'help'
        ? '/library/import/phone-wifi/help'
        : `/library/import/phone-${name}`;
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

/** Read-only route entry, then the person's explicit Connect action. */
export async function openPhone(page: Page): Promise<void> {
  await open(page, tab('wifi'));
  await page.locator('[data-action=wifi-connect]').click();
}
export async function followReception(page: Page): Promise<void> {
  await page.locator('a[href="/library/imports?phones=true"]').last().click();
  await onTab(page, 'transfers');
}
export async function openHelp(page: Page): Promise<void> {
  await page.locator('a[href="/library/import/phone-wifi/help"]').last().click();
  await onTab(page, 'help');
}
