// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's DuckingPlanner (render-ducking.ts): registered with the app's FFmpeg so render's mixer can
 * duck the music under the voice, and never in place of one a root already registered.
 */
import { describe, expect, it } from 'vitest';
import {
  ClockToken,
  createContainer,
  createEventBus,
  createManualClock,
  DuckingPlannerToken,
  EventBusToken,
  ok,
  type DuckingPlanner,
} from '@taalcut/core';
import { registerDuckingPlanner } from '../src/utility/roots/render-ducking';

const binaries = { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', source: 'sidecar' } as const;

function renderContainer() {
  const clock = createManualClock(0);
  return createContainer().value(ClockToken, clock).value(EventBusToken, createEventBus({ clock }));
}

describe('render process ducking', () => {
  it('registers a planner the mixer resolves', () => {
    const container = renderContainer();
    registerDuckingPlanner(container, { binaries });
    const planner = container.resolve(DuckingPlannerToken);
    expect(typeof planner.plan).toBe('function');
    expect(typeof planner.check).toBe('function');
  });

  it('keeps a planner that is already registered', () => {
    const own: DuckingPlanner = {
      plan: async () => ok({ music: [], effects: [] }),
      check: async (_stems, marginLu) =>
        ok({ frames: 0, counted: 0, marginLu, minMarginLu: null, worst: [], passed: true }),
    };
    const container = renderContainer().value(DuckingPlannerToken, own);
    registerDuckingPlanner(container, { binaries });
    expect(container.resolve(DuckingPlannerToken)).toBe(own);
  });
});
