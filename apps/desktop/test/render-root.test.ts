// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's root (P2-M6, P2-M11): it composes over the library's
 * ports, serves the renders router (presets, the list from the shared
 * render store) and the worker, and answers a render that doesn't exist
 * with core.not_found rather than crashing.
 */
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { connectRpc, fromRpcError, newId, serveRpc, UTILITY_CONTRACTS } from '@taalcut/core';
import { EXPORT_PRESETS } from '@taalcut/render';
import { composeRender } from '../src/utility/roots/render-root';
import type { UtilityRoot } from '../src/utility/runtime';
import { testConfig } from './helpers/roots';

const roots: UtilityRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await root.container.dispose();
});

async function client() {
  const root = await composeRender(testConfig('render'), 21);
  roots.push(root);
  const { port1, port2 } = new MessageChannel();
  serveRpc(root.router, port1, { context: { caller: 'main' } });
  return connectRpc(UTILITY_CONTRACTS.render, port2, { peer: 'render' }).client;
}

// Each test composes the whole root: a fresh database with every migration. That takes about a
// second alone and well over Vitest's 5 s default while the full suite runs FFmpeg next to it.
describe('render root', { timeout: 20_000 }, () => {
  it('serves the presets and an empty renders list', async () => {
    const render = await client();
    expect((await render.renders.presets()).map((preset) => preset.id)).toEqual(
      EXPORT_PRESETS.map((preset) => preset.id),
    );
    expect(await render.renders.list({})).toEqual([]);
  });

  it('answers a missing render with core.not_found', async () => {
    const render = await client();
    const failure = await render.renders
      .get({ renderId: newId<'Render'>() })
      .catch((cause: unknown) => fromRpcError(cause));
    expect(failure).toMatchObject({ code: 'core.not_found' });
  });

  it("refuses an export of a render the store doesn't hold", async () => {
    const render = await client();
    const projectId = newId<'Project'>();
    const stream = render.worker.export({
      renderId: newId<'Render'>(),
      request: {
        projectId,
        timelineId: newId<'Timeline'>(),
        presetId: 'device',
        captions: { burnIn: true, sidecars: [] },
      },
    });
    const failure = await (async () => {
      for await (const item of await stream) void item;
    })().catch((cause: unknown) => fromRpcError(cause));
    expect(failure).toMatchObject({ code: 'core.not_found' });
  });
});
