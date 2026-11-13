// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What UI round 2b's specs share (flow, privacy, onboarding, feedback): axe on
 * the page as it is now, the pseudo-locale checks on it, the fakes' options,
 * and screenshots in light and dark (to TAALCUT_UI2B_SCREENS when set, else
 * e2e-artifacts/screenshots/ui2b/).
 */
import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, screenshotWhole } from './support.ts';

/** Axe on the page as it is now (e2e/axe.ts: every impact fails, target size on). */
export { expectAccessible } from './axe.ts';

const phrases = englishPhrases();

/** The pseudo-locale checks on the page as it is now: nothing English, nothing clipped. */
export async function expectPseudoClean(page: Page, label: string): Promise<void> {
  const text = await userFacingText(page);
  expect(englishShowing(text, phrases), `${label}: English source strings on screen`).toEqual([]);
  expect(untranslated(text), `${label}: strings that skipped the catalogue`).toEqual([]);
  expect(await clippedText(page), `${label}: text that does not fit`).toEqual([]);
}

const SHOTS = process.env.TAALCUT_UI2B_SCREENS ?? new URL('screenshots/ui2b/', ARTIFACTS).pathname;

/** A screenshot of the whole page as `ui2b-<name>.png`. */
export async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  // screenshotWhole resolves against e2e-artifacts; an absolute file URL keeps it where it is.
  await screenshotWhole(page, new URL(`ui2b-${name}.png`, `file://${SHOTS.replace(/\/?$/, '/')}`).href);
}

/** The fakes' options for UI round 2b's screens (src/backend/fake/expose.ts, src/chat/fake-client.ts). */
export interface Ui2bFakeOptions {
  onboarding?: 'done' | 'fresh' | 'midway';
  channel?: 'internal' | 'alpha' | 'beta' | 'stable';
  downloadTickMs?: number;
  localOnly?: boolean;
  telemetry?: boolean;
  /** The scripted flow stops at the project's budget. */
  budget?: 'cap';
  library?: number | 'empty';
  indexingTickMs?: number;
  speed?: number;
  latencyMs?: number;
  pickedFolder?: string | null;
  // Phase 3 (src/backend/fake/expose.ts phase3OptionsFromStorage).
  update?: 'idle' | 'downloading' | 'ready' | 'rolled-back';
  /** The Mac's preferred languages, in order (locale detection). */
  systemLanguages?: readonly string[];
  mcp?: 'off' | 'on' | 'sessions' | 'error';
  limits?: 'none' | 'one' | 'three';
  usb?: 'none' | 'iphone' | 'android' | 'iphone-icloud';
  usbTickMs?: number;
  starters?: 'error';
  templates?: 'empty';
  projects?: 'empty';
  renderTickMs?: number;
  libraryLatencyMs?: number;
  transfer?: 'phone' | 'waiting' | 'no-network' | 'blocked' | 'local-network-denied' | 'idle';
  transferSpeed?: number;
  /** The hardware probe (first run's This Mac step). */
  tier?: 'minimum' | 'recommended' | 'high';
  freeDiskGb?: number;
  /** LNX1: the probed machine (src/backend/fake/fake-system.ts); off the Mac the app also runs as on Linux. */
  system?:
    | 'mac'
    | 'linux-nvidia'
    | 'linux-cpu'
    | 'linux-nvidia-old-driver'
    | 'linux-nouveau'
    | 'linux-pascal'
    | 'linux-amd'
    | 'linux-intel';
  /** The probe fails (models.hardware_probe_failed). */
  probe?: 'error';
  /** Settings › Usage's states (src/backend/fake/fake-usage.ts). */
  usage?: 'empty' | 'slow' | 'failing';
  /** UX2-MODELS: the indexing models missing, or one of them that won't download (fake-downloads.ts). */
  models?: 'missing' | 'broken';
  /** UX2-DOWNLOADER: a download under way when the page opens, or paused (fake-downloads.ts). */
  downloads?: 'midway' | 'paused';
  /** The media cards' timelines with their voiceovers, graphics and image slots on (phase3/media-arrange.ts). */
  media?: { arranged: boolean };
}

export async function fakes(page: Page, options: Ui2bFakeOptions): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify(options),
  });
}

/** What the page's fake keeps for tests (window.taalcutFake: src/backend/fake/fake-backend.ts FakeControls). */
export function fakeState<T>(page: Page, read: string): Promise<T> {
  return page.evaluate((path) => {
    let value: unknown = (window as unknown as { taalcutFake?: unknown }).taalcutFake;
    for (const key of path.split('.')) value = (value as Record<string, unknown> | undefined)?.[key];
    return JSON.parse(JSON.stringify(value ?? null)) as unknown;
  }, read) as Promise<T>;
}
