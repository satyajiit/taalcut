// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createMemorySettingsStore, ok, type PluginSecrets } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createInstagramEditsPluginDefinition, createPluginService } from '@taalcut/tools';

const navigators = [
  'api.browseMusicCategories',
  'api.listMusicTracks',
  'api.getSavedTracks',
  'api.getMusicTrackDetails',
  'api.searchSoundEffects',
  'api.inspectProject',
];

async function setup() {
  const call = vi.fn(async () => ok({ screen: 'home' }));
  const resolveMediaPath = vi.fn(async () => ok('/tmp/render.mp4'));
  const definition = createInstagramEditsPluginDefinition({
    connectMcp: async () => ok({ tools: [], call, close: async () => {} }),
    resolveMediaPath,
  });
  const values = new Map<string, string>();
  const secrets: PluginSecrets = {
    get: async (key) => ok(values.get(key)),
    set: async (key, value) => {
      values.set(key, value);
      return ok(undefined);
    },
    delete: async (key) => {
      values.delete(key);
      return ok(undefined);
    },
  };
  const service = createPluginService({
    definitions: [definition],
    secrets,
    settings: createMemorySettingsStore(),
    networkAllowed: async () => true,
  });
  await service.importCredential('instagram-edits', 'access-token', 'test-secret');
  await service.setAccess({
    pluginId: 'instagram-edits',
    access: ['music-read', 'projects-read', 'projects-write'],
  });
  expect((await service.setEnabled({ pluginId: 'instagram-edits', enabled: true })).ok).toBe(true);
  return { service, call, resolveMediaPath, definition };
}

describe('Instagram Edits external-action boundaries', () => {
  it('blocks every project-navigation wrapper on the read path and without project-write access', async () => {
    const { service, call } = await setup();
    try {
      for (const toolName of navigators) {
        expect(
          await service.invoke({ pluginId: 'instagram-edits', toolName, input: {}, mode: 'read' }),
        ).toMatchObject({ ok: false, error: { code: 'tools.plugin_access_denied' } });
      }
      await service.setAccess({ pluginId: 'instagram-edits', access: ['music-read', 'projects-read'] });
      for (const toolName of navigators) {
        expect(
          await service.invoke({
            pluginId: 'instagram-edits',
            toolName,
            input: {},
            mode: 'external',
            idempotencyKey: toolName,
          }),
        ).toMatchObject({ ok: false, error: { code: 'tools.plugin_access_denied' } });
      }
      expect(call).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

  it('rejects unregistered preview input before any remote navigation or playback', async () => {
    const { service, call } = await setup();
    try {
      expect(
        await service.invoke({
          pluginId: 'instagram-edits',
          toolName: 'api.getMusicTrackDetails',
          input: { track: 'track-id', preview: true },
          mode: 'external',
          idempotencyKey: 'preview-rejected',
        }),
      ).toMatchObject({ ok: false, error: { code: 'tools.plugin_invalid_input' } });
      expect(call).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

  it('rejects explicit caption duration before media resolution or any remote effect', async () => {
    const { service, call, resolveMediaPath, definition } = await setup();
    const input = { renderId: 'render-123', captions: [{ text: 'Hook', startTime: 0.5, duration: 2.5 }] };
    try {
      expect(
        (
          await service.invoke({
            pluginId: 'instagram-edits',
            toolName: 'api.stageReel',
            input,
            mode: 'external',
            idempotencyKey: 'duration-test',
          })
        ).ok,
      ).toBe(false);
      // Exercise the adapter guard as well as the service's JSON schema validation.
      const noop = async () => ok(undefined);
      const adapter = definition.create({
        config: {},
        secrets: { get: async () => ok('test-secret') },
        data: { get: noop, set: noop, delete: noop, clear: noop },
      });
      try {
        await adapter.connect(AbortSignal.timeout(1000));
        expect(await adapter.invoke('api.stageReel', input, AbortSignal.timeout(1000))).toMatchObject({
          ok: false,
          error: { code: 'tools.plugin_invalid_input' },
        });
      } finally {
        await adapter.dispose();
      }
      expect(resolveMediaPath).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });
});
