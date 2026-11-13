// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineCommand, idSchema, newId, ok, RENDER_COMMANDS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { creationMedia } from '../src/utility/creation/production-media';
import { approvedFilm, creationWorld } from './helpers/creation';

describe('Create export cancellation', () => {
  it('does not queue an export when cancellation already arrived', async () => {
    const world = creationWorld();
    const film = await approvedFilm(world);
    const controller = new AbortController();
    let queued = 0;
    world.bus.register(
      defineCommand({
        name: RENDER_COMMANDS.export,
        payload: z.object({ projectId: idSchema<'Project'>() }),
        sideEffect: 'write',
        handle: async () => {
          queued++;
          return ok({ result: { renderId: newId<'Render'>() } });
        },
      }),
    );
    controller.abort();
    const result = await creationMedia(world.container).finalize(film.timeline.id, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(queued).toBe(0);
  });

  it('cancels the queued render when cancellation arrives during export dispatch', async () => {
    const world = creationWorld();
    const film = await approvedFilm(world);
    const controller = new AbortController();
    const renderId = newId<'Render'>();
    const canceled: unknown[] = [];
    const cancelCommitted = Promise.withResolvers<void>();
    world.bus.subscribe((change) => {
      if (change.name === RENDER_COMMANDS.cancel) cancelCommitted.resolve();
    });
    world.bus.register(
      defineCommand({
        name: RENDER_COMMANDS.export,
        payload: z.object({ projectId: idSchema<'Project'>() }),
        sideEffect: 'write',
        handle: async () => {
          controller.abort();
          return ok({ result: { renderId } });
        },
      }),
      defineCommand({
        name: RENDER_COMMANDS.cancel,
        payload: z.object({ projectId: idSchema<'Project'>(), renderId: idSchema<'Render'>() }),
        sideEffect: 'write',
        handle: async (input) => {
          canceled.push(input);
          return ok({ result: undefined });
        },
      }),
    );
    const result = await creationMedia(world.container).finalize(film.timeline.id, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await cancelCommitted.promise;
    expect(canceled).toEqual([{ projectId: film.projectId, renderId }]);
  });
});
