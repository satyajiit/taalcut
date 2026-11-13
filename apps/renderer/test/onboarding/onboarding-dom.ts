// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, waitFor } from '@testing-library/react';
import type { FakeBackendOptions } from '../../src/backend/fake/fake-backend';

/** The one element a selector names; a test that can't find it fails with the selector. */
export function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

/** Waits for the control to be there, enabled and not busy (a loading button ignores clicks), then clicks it. */
export async function press(selector: string): Promise<void> {
  const target = await waitFor(() => el(`${selector}:not([disabled]):not([aria-busy="true"])`), {
    timeout: 3000,
  });
  await act(async () => {
    fireEvent.click(target);
  });
}

/** Opens a way's row (the ways to think, the sources) by its id. */
export const openWay = (id: string) => press(`li[data-way="${id}"] > button`);

export const continueButton = () => el('[data-action="continue"]');

/** A clean profile on a stable build: nothing signed in, no library, first run not started. */
export const freshMac = (extra: Pick<FakeBackendOptions, 'phase2' | 'phase3'> = {}) => ({
  phase2b: { onboarding: { scenario: 'fresh' as const, downloadTickMs: 0 } },
  phase2: { library: { count: 0, tickMs: 0 }, ...extra.phase2 },
  phase3: { updates: { channel: 'stable' as const }, ...extra.phase3 },
});

/** Shared LIB2 selection and review, without leaving the setup step. */
export async function startImport(): Promise<void> {
  await press('[data-action="import-connect"]');
  await press('[data-item-index="0"]');
  await press('[data-action="review-import"]');
  await press('[data-action="start-import"]');
}
