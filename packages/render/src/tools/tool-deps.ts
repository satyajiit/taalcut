// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What the agent's render tools read (render-tools.ts, the batch tool). */
import type { JobRunner, RenderStore, SettingsStore } from '@taalcut/core';
import type { ProvenanceLookup } from '../credentials';
import type { TimelineAccess } from '../ports';

export interface RenderToolDeps {
  readonly store: RenderStore;
  readonly timelines: TimelineAccess;
  /** The same store the render commands write export settings to. */
  readonly settings?: SettingsStore;
  /** Main's job runner: render.export follows its job to the end. Without it the tool returns once queued. */
  readonly jobs?: JobRunner;
  /** P3-V7: where assets came from, for the disclosure reminders in render.export's output. */
  readonly provenance?: ProvenanceLookup;
}
