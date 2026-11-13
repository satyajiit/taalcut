// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { ok } from '@taalcut/core';
import {
  COMFYUI_DEFAULT_URL,
  comfyuiConfigSchema,
  comfyuiManifest,
  createComfyUiPluginDefinition,
} from '@taalcut/tools';

describe('ComfyUI plugin definition (WP-GEN-COMFY)', () => {
  it('validates loopback and LAN ComfyUI URLs while rejecting insecure public HTTP or path traversal', () => {
    const valid = comfyuiConfigSchema.safeParse({
      'server-url': 'http://127.0.0.1:8188',
      'default-checkpoint': 'flux1-schnell-fp8.safetensors',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data['server-url']).toBe(COMFYUI_DEFAULT_URL);
    }

    const insecurePublic = comfyuiConfigSchema.safeParse({
      'server-url': 'http://example.com:8188',
      'default-checkpoint': 'flux1-schnell-fp8.safetensors',
    });
    expect(insecurePublic.success).toBe(false);

    const traversal = comfyuiConfigSchema.safeParse({
      'server-url': 'http://127.0.0.1:8188',
      'default-checkpoint': '../secrets.safetensors',
    });
    expect(traversal.success).toBe(false);
  });

  it('connects to /system_stats, queues a workflow prompt, and reads /history/<promptId>', async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/system_stats')) {
        return new Response(JSON.stringify({ system: { os: 'darwin' }, devices: [{ name: 'mps' }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-99', number: 1 }), { status: 200 });
      }
      if (url.endsWith('/history/prompt-99')) {
        return new Response(
          JSON.stringify({
            'prompt-99': {
              outputs: { '7': { images: [{ filename: 'taalcut_0001.png', type: 'output' }] } },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const def = createComfyUiPluginDefinition({ fetch: fakeFetch });
    expect(def.manifest.id).toBe(comfyuiManifest.id);

    const instance = def.create({
      config: {
        'server-url': COMFYUI_DEFAULT_URL,
        'default-checkpoint': 'flux1-schnell-fp8.safetensors',
      },
      secrets: {
        async get() {
          return ok(undefined);
        },
      },
      data: {
        async get() {
          return ok(undefined);
        },
        async set() {
          return ok(undefined);
        },
        async delete() {
          return ok(undefined);
        },
        async clear() {
          return ok(undefined);
        },
      },
    });

    const signal = new AbortController().signal;
    const connected = await instance.connect(signal);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.value.map((t) => t.name)).toEqual([
      'api.getSystemStats',
      'api.queuePrompt',
      'api.getHistory',
    ]);

    const queued = await instance.invoke(
      'api.queuePrompt',
      { prompt: { '1': { class_type: 'CheckpointLoaderSimple', inputs: {} } } },
      signal,
    );
    expect(queued.ok).toBe(true);

    const history = await instance.invoke('api.getHistory', { promptId: 'prompt-99' }, signal);
    expect(history.ok).toBe(true);

    const invalidHistory = await instance.invoke('api.getHistory', { promptId: '../etc/passwd' }, signal);
    expect(invalidHistory.ok).toBe(false);

    await instance.dispose();
    expect(calls).toEqual([
      'GET http://127.0.0.1:8188/system_stats',
      'POST http://127.0.0.1:8188/prompt',
      'GET http://127.0.0.1:8188/history/prompt-99',
    ]);
  });
});
