// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Phase2FakeOptions } from '../fake-phase2';
import type { FakeMakeOptions } from '../make/make-options';
import type { Phase3FakeOptions } from '../phase3/fake-phase3';

/**
 * What one area's fakes take from `taalcut.fake` (localStorage), so e2e tests set their scenario before the page
 * starts. Each area reads its own keys; expose.ts merges every area's options into the fake's.
 */
export interface AreaOptions {
  readonly phase2?: Phase2FakeOptions;
  readonly make?: FakeMakeOptions;
  readonly phase3?: Phase3FakeOptions;
}

export type AreaOptionsReader = (stored: Readonly<Record<string, unknown>>) => AreaOptions;
