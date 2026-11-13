// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WP-GEN-COMFY: Bring-your-own ComfyUI local ImageProvider (`http://127.0.0.1:8188`).
 * Works under Local only when pointed at loopback, refuses non-loopback under Local only, verifies returned PNG/JPEG
 * dimensions and aspect ratio, and logs local CloudCall rows at US$0.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildComfyUiImageWorkflow,
  COMFYUI_PROVIDER,
  createComfyUiImageProvider,
  createMemoryCloudCallSink,
  MODEL_CATALOG,
} from '@taalcut/models';

/** Minimal valid PNG header with given width and height (IHDR). */
function minimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function startFakeComfyServer(pngBytes: Uint8Array) {
  const hits: { method: string; url: string; body?: unknown }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '/';
      const raw = Buffer.concat(chunks).toString('utf8');
      hits.push({ method: req.method ?? 'GET', url, ...(raw ? { body: JSON.parse(raw) } : {}) });
      if (req.method === 'POST' && url === '/prompt') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: 'prompt-123' }));
        return;
      }
      if (req.method === 'GET' && url === '/history/prompt-123') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            'prompt-123': {
              outputs: {
                '7': {
                  images: [{ filename: 'taalcut_still_0001.png', subfolder: '', type: 'output' }],
                },
              },
            },
          }),
        );
        return;
      }
      if (req.method === 'GET' && url.startsWith('/view?')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from(pngBytes));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
  };
}

describe('ComfyUI Bring-Your-Own ImageProvider (WP-GEN-COMFY)', () => {
  it('registers ComfyUI models as own-server local entries in MODEL_CATALOG', () => {
    const entries = MODEL_CATALOG.filter((e) => e.provider === COMFYUI_PROVIDER);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) {
      expect(entry.servedBy).toBe('own-server');
      expect(entry.local).toBe(true);
      expect(entry.kind).toBe('image');
    }
  });

  it('generates a portrait still on loopback even when Local only is on, at US$0', async () => {
    const comfy = await startFakeComfyServer(minimalPng(576, 1024));
    const callLog = createMemoryCloudCallSink();
    const provider = createComfyUiImageProvider({
      baseUrl: () => comfy.baseUrl,
      callLog,
      localOnly: () => true,
      pollIntervalMs: 1,
    });

    expect(await provider.available('comfyui/flux-1-schnell')).toEqual({ ok: true });
    expect(provider.estimate('comfyui/flux-1-schnell', { size: 'draft', count: 1 })).toEqual({
      usd: 0,
      estimated: false,
    });

    const made = await provider.generate('comfyui/flux-1-schnell', {
      prompt: 'Neon rainy street in Mumbai at night',
      avoid: 'blurry text, watermark',
      aspect: '9:16',
      size: 'draft',
      count: 1,
      seed: 101,
    });
    if (!made.ok) throw new Error(made.error.code);
    expect(made.value).toHaveLength(1);
    expect(made.value[0]).toMatchObject({
      provider: 'comfyui',
      model: 'flux1-schnell-fp8.safetensors',
      mediaType: 'image/png',
      width: 576,
      height: 1024,
      costUsd: 0,
    });
    expect(callLog.records[0]).toMatchObject({
      provider: 'comfyui',
      module: 'images',
      local: true,
      costUsd: 0,
    });
    const workflow = buildComfyUiImageWorkflow({
      checkpoint: 'flux1-schnell-fp8.safetensors',
      prompt: 'test',
      negativePrompt: 'ugly',
      width: 576,
      height: 1024,
      count: 1,
      seed: 1,
      steps: 4,
      cfg: 1,
    });
    expect(workflow['7']).toMatchObject({ class_type: 'SaveImage' });
  });

  it('refuses a non-loopback LAN ComfyUI server when Local only is on', async () => {
    const callLog = createMemoryCloudCallSink();
    const provider = createComfyUiImageProvider({
      baseUrl: () => 'http://192.168.1.50:8188',
      allowLan: true,
      callLog,
      localOnly: () => true,
    });
    expect(await provider.available('comfyui/flux-1-schnell')).toEqual({
      ok: false,
      reason: 'local_only',
    });
    const refused = await provider.generate('comfyui/flux-1-schnell', {
      prompt: 'test',
      aspect: '1:1',
      size: 'draft',
      count: 1,
    });
    expect(!refused.ok && refused.error.code).toBe('core.local_only');
  });
});
