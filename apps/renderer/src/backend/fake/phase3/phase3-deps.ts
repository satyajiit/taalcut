// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { EventBus, Money, ProjectId, SettingsStore } from '@taalcut/core';
import type { FakeUsage } from '../fake-usage';
import type { FakeLibrary } from '../library/fake-library';
import type { FakeMake } from '../make/fake-make';
import type { FakeTemplates } from '../templates/fake-templates';

/** What the Phase 3 fakes are built from (fake-phase3.ts makes them; each area's fake takes what it reads). */
export interface Phase3Deps {
  readonly now: () => number;
  readonly settings: SettingsStore;
  readonly usage: FakeUsage;
  readonly templates: FakeTemplates;
  /** How many clips the library holds, for the starters' best fit. */
  readonly libraryClips: () => number;
  readonly capOf: (projectId: ProjectId) => Money | null;
  /** Phase 3 (ui-make): the event bus, the library, the Make fakes and whether Local only is on. */
  readonly events: EventBus;
  readonly library: FakeLibrary;
  readonly make: FakeMake;
  readonly localOnly: () => boolean;
}
