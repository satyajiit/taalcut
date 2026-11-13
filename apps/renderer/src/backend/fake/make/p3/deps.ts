// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every Phase 3 Make fake (energy curve, cleanup, gaps, interchange, the batch queue) is built from: the
 * Phase 2 Make fakes' timelines, renders and projects, the shots the seed cast from, and the event bus. Each
 * module answers its procedures as the real backend does (core's contract and errors) and registers its commands
 * on the fake's bus; fake-make.ts spreads its procedures into the namespace they belong to.
 */
import type { EventBus } from '@taalcut/core';
import type { FakeTemplates } from '../../templates/fake-templates';
import type { FakeMakeOptions } from '../make-options';
import type { FakeProjects } from '../fake-projects';
import type { FakeRenders } from '../fake-renders';
import type { FakeTimelines } from '../fake-timelines';
import type { idMaker } from '../ids';
import type { PoolShot } from '../shot-pool';

export interface MakeP3Deps {
  readonly events: EventBus;
  readonly timelines: FakeTimelines;
  readonly renders: FakeRenders;
  readonly projects: FakeProjects;
  readonly shots: Map<string, PoolShot>;
  readonly ids: ReturnType<typeof idMaker>;
  /** The saved templates (template.setEnergyCurve writes through `edit`). */
  readonly templates: FakeTemplates;
  /** The Make fakes' options; an area reads its own scenario from `options.areas?.[area]`. */
  readonly options: FakeMakeOptions;
}
