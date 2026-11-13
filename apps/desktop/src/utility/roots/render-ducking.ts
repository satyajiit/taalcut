// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's DuckingPlanner in the render process (packages/audio SPEC P3.5, render SPEC P3.9): render's mixer asks it
 * for the music's gain envelope under the voice, given the rendered stems. Audio plans it with ebur128 on FFmpeg
 * (the CPU, logged once as Phase 2's accepted fallback).
 */
import { DuckingPlannerToken, EventBusToken, type Container } from '@taalcut/core';
import { createDuckingPlanner } from '@taalcut/audio';
import type { MediaContext } from '@taalcut/media';

export function registerDuckingPlanner(container: Container, media: Pick<MediaContext, 'binaries'>): void {
  if (container.has(DuckingPlannerToken)) return;
  container.factory(
    DuckingPlannerToken,
    ({ events }) =>
      createDuckingPlanner({
        media: { binaries: media.binaries },
        onComputeFallback: (event) => events.emit('compute.fallback', event),
      }),
    { deps: { events: EventBusToken } },
  );
}
