// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { createMemorySettingsStore, err, ok } from '@taalcut/core';
import {
  createPluginService,
  createPostizPluginDefinition,
  PluginRemoteFailed,
  postizManifest,
} from '../../src';
import { postizConfigSchema } from '../../src/plugins/postiz-config';
import { postizOperations } from '../../src/plugins/postiz-operations';
import type { PluginMcpConnector } from '../../src/plugins/mcp-client';
import type { OpenPluginUpload } from '../../src/plugins/postiz-http';

function world(options: { connectMcp?: PluginMcpConnector; openUpload?: OpenPluginUpload } = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ connected: true }));
  const vault = new Map<string, string>();
  const connectMcp =
    options.connectMcp ??
    vi
      .fn<PluginMcpConnector>()
      .mockResolvedValue(ok({ tools: [], call: async () => ok(null), close: async () => {} }));
  const service = createPluginService({
    definitions: [createPostizPluginDefinition({ fetch: fetcher, connectMcp, ...options })],
    settings: createMemorySettingsStore(),
    networkAllowed: async () => true,
    secrets: {
      get: async (key) => ok(vault.get(key)),
      set: async (key, value) => {
        vault.set(key, value);
        return ok(undefined);
      },
      delete: async (key) => {
        vault.delete(key);
        return ok(undefined);
      },
    },
  });
  return {
    service,
    fetcher,
    connectMcp,
    async activate(config?: Record<string, string>) {
      if (config) expect((await service.configure({ pluginId: 'postiz', config })).ok).toBe(true);
      await service.importCredential('postiz', 'api-key', 'private-test-key');
      await service.setAccess({
        pluginId: 'postiz',
        access: postizManifest.access.map((access) => access.id),
      });
      expect((await service.setEnabled({ pluginId: 'postiz', enabled: true })).ok).toBe(true);
    },
  };
}

describe('Postiz definition and endpoints', () => {
  it('covers every documented REST operation without an arbitrary request escape hatch', () => {
    const operations = postizOperations();
    expect(operations.map((op) => `${op.method} ${op.path}`)).toEqual([
      'GET /integrations',
      'GET /groups',
      'GET /social/{integration}',
      'GET /integration-settings/{id}',
      'POST /integration-trigger/{id}',
      'DELETE /integrations/{id}',
      'GET /is-connected',
      'GET /me',
      'GET /find-slot/{id}',
      'GET /analytics/{integration}',
      'GET /analytics/post/{postId}',
      'GET /notifications',
      'GET /posts',
      'POST /posts',
      'DELETE /posts/{id}',
      'DELETE /posts/group/{group}',
      'GET /posts/{id}/missing',
      'PUT /posts/{id}/release-id',
      'PUT /posts/{id}/status',
      'PUT /posts/{id}/settings',
      'POST /upload',
      'POST /upload-from-url',
      'GET /media/{id}/status',
      'GET /media',
      'POST /generate-video',
      'POST /video/function',
      'POST /clipping',
      'GET /clipping/{id}',
      'GET /clipping',
    ]);
  });

  it.each([
    'http://postiz-local:4007/api/public/v1',
    'https://postiz.tailnet.example/api/public/v1',
    'http://100.100.10.20:3000/public/v1',
    'http://127.0.0.1:3000/public/v1',
  ])('keeps self-hosted credentials on the configured instance: %s', async (apiUrl) => {
    const w = world();
    await w.activate({ 'api-url': apiUrl, 'mcp-url': '' });
    expect(String(w.fetcher.mock.calls[0]![0])).toBe(`${apiUrl}/is-connected`);
    expect(w.fetcher.mock.calls[0]![1]).toMatchObject({
      headers: { Authorization: 'private-test-key' },
      redirect: 'error',
    });
    expect(w.connectMcp).toHaveBeenCalledWith(
      expect.objectContaining({ url: apiUrl.replace('/public/v1', '/mcp'), token: 'private-test-key' }),
    );
    expect(JSON.stringify(await w.service.describe('postiz'))).not.toContain('private-test-key');
    await w.service.dispose();
  });

  it.each([
    { 'api-url': 'http://example.com/public/v1' },
    { 'api-url': 'https://user:secret@example.com/public/v1' },
    { 'api-url': 'https://example.com/public/v1?apiKey=secret' },
    { 'api-url': 'https://example.com/api' },
    { 'api-url': 'https://example.com/public/v1', 'mcp-url': 'https://mcp.postiz.com/mcp' },
    { 'api-url': 'https://example.com/public/v1', 'mcp-url': 'https://example.com/mcp/secret' },
  ])('rejects unsafe or ambiguous configuration', (config) => {
    expect(postizConfigSchema.safeParse(config).success).toBe(false);
  });

  it('uses the hosted MCP endpoint only for the hosted API default', async () => {
    const w = world();
    await w.activate();
    expect(w.connectMcp).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://mcp.postiz.com/mcp' }));
    await w.service.dispose();
  });
});

describe('Postiz operations', () => {
  it('validates arguments, encodes path IDs, sends queries and redacts successful echoes', async () => {
    const w = world();
    await w.activate();
    w.fetcher.mockResolvedValue(Response.json({ note: 'private-test-key', count: 3 }));
    const call = { pluginId: 'postiz', toolName: 'api.getPostAnalytics', mode: 'read' as const };
    const result = await w.service.invoke({ ...call, input: { postId: 'a/b', date: '30' } });
    expect(String(w.fetcher.mock.lastCall![0])).toBe(
      'https://api.postiz.com/public/v1/analytics/post/a%2Fb?date=30',
    );
    expect(result).toEqual(ok({ note: '[REDACTED]', count: 3 }));
    w.fetcher.mockClear();
    expect((await w.service.invoke({ ...call, input: { postId: '..', date: '30' } })).ok).toBe(false);
    expect((await w.service.invoke({ ...call, input: { postId: 'id', date: 'yesterday' } })).ok).toBe(false);
    expect(w.fetcher).not.toHaveBeenCalled();
    await w.service.dispose();
  });

  it('sends validated post bodies and does not retry ambiguous publishing', async () => {
    const w = world();
    await w.activate();
    const input = {
      type: 'schedule',
      date: '2026-12-01T12:00:00Z',
      shortLink: false,
      tags: [],
      posts: [
        { integration: { id: 'channel' }, value: [{ content: 'Hello' }], settings: { __type: 'bluesky' } },
      ],
    };
    w.fetcher.mockResolvedValue(Response.json({ id: 'post-1' }));
    const command = {
      pluginId: 'postiz',
      toolName: 'api.createPost',
      input,
      mode: 'external' as const,
      idempotencyKey: 'publish-1',
    };
    expect(await w.service.invoke(command)).toEqual(ok({ id: 'post-1' }));
    expect(w.fetcher.mock.lastCall![1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(input),
      redirect: 'error',
    });
    expect(await w.service.invoke(command)).toEqual(ok({ id: 'post-1' }));
    expect(w.fetcher).toHaveBeenCalledTimes(2);
    await w.service.dispose();
  });

  it('uploads only a resolved asset or render with multipart data', async () => {
    const openUpload = vi
      .fn<OpenPluginUpload>()
      .mockResolvedValue(ok({ file: new Blob(['video'], { type: 'video/mp4' }), name: 'reel.mp4' }));
    const w = world({ openUpload });
    await w.activate();
    w.fetcher.mockResolvedValue(
      Response.json({ id: 'uploaded', path: 'https://uploads.postiz.com/reel.mp4' }),
    );
    const assetId = '01J00000000000000000000000';
    expect(
      (
        await w.service.invoke({
          pluginId: 'postiz',
          toolName: 'api.uploadFile',
          input: { assetId, adjust: true },
          mode: 'external',
          idempotencyKey: 'upload-1',
        })
      ).ok,
    ).toBe(true);
    expect(openUpload).toHaveBeenCalledWith({ assetId }, expect.any(AbortSignal));
    const request = w.fetcher.mock.lastCall![1]!;
    expect(request.headers).not.toHaveProperty('Content-Type');
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('adjust')).toBe('true');
    expect(((request.body as FormData).get('file') as File).name).toBe('reel.mp4');
    const result = await w.service.invoke({
      pluginId: 'postiz',
      toolName: 'api.uploadFile',
      input: { filePath: '/etc/passwd' },
      mode: 'external',
      idempotencyKey: 'upload-2',
    });
    expect(result.ok).toBe(false);
    expect(openUpload).toHaveBeenCalledTimes(1);
    await w.service.dispose();
  });

  it('keeps API features when a self-hosted installation has no MCP route', async () => {
    const w = world({ connectMcp: async () => err(PluginRemoteFailed({ pluginId: 'postiz' })) });
    await w.activate({ 'api-url': 'http://postiz-local:4007/api/public/v1' });
    const tools = await w.service.tools('postiz');
    expect(tools.ok && tools.value.length).toBe(29);
    await w.service.dispose();
  });

  it('classifies known MCP reads and treats unknown server tools as external', async () => {
    const call = vi.fn().mockResolvedValue(ok({ content: [{ type: 'text', text: 'done' }] }));
    const w = world({
      connectMcp: async () =>
        ok({
          tools: [
            { name: 'integrationList', inputSchema: { type: 'object' } },
            { name: 'integrationSchedulePostTool', inputSchema: { type: 'object' } },
            { name: 'uploadFromUrlTool', inputSchema: { type: 'object' } },
            {
              name: 'brandNewPublish',
              inputSchema: { type: 'object' },
              description: 'The server calls this read-only.',
            },
          ],
          call,
          close: async () => {},
        }),
    });
    await w.activate();
    const tools = await w.service.tools('postiz');
    expect(tools.ok && tools.value.find((tool) => tool.name === 'mcp.brandNewPublish')).toMatchObject({
      access: ['mcp-extended'],
      sideEffect: 'external',
    });
    expect(
      tools.ok && tools.value.find((tool) => tool.name === 'mcp.integrationSchedulePostTool'),
    ).toMatchObject({ access: ['posts-write'], sideEffect: 'external' });
    expect(tools.ok && tools.value.find((tool) => tool.name === 'mcp.uploadFromUrlTool')).toMatchObject({
      access: ['media-write'],
      sideEffect: 'external',
    });
    expect(
      (
        await w.service.invoke({
          pluginId: 'postiz',
          toolName: 'mcp.brandNewPublish',
          input: {},
          mode: 'read',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await w.service.invoke({
          pluginId: 'postiz',
          toolName: 'mcp.integrationList',
          input: {},
          mode: 'read',
        })
      ).ok,
    ).toBe(true);
    expect(call).toHaveBeenCalledWith('integrationList', {}, expect.any(AbortSignal));
    await w.service.dispose();
  });

  it.each([401, 403, 429, 500])('returns safe error values for HTTP %i', async (status) => {
    const w = world();
    await w.activate();
    w.fetcher.mockResolvedValue(new Response('private-test-key secret error body', { status }));
    const result = await w.service.invoke({
      pluginId: 'postiz',
      toolName: 'api.listGroups',
      input: {},
      mode: 'read',
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-test-key');
    await w.service.dispose();
  });
});
