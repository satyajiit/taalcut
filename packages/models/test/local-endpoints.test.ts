// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F4 local servers: an OpenAI-compatible endpoint (Ollama, LM Studio) is
 * configured by base URL, its models are discovered, and the next call uses
 * it. The live Ollama version of discovery is in ollama.live.test.ts.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverLocalModels } from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

/** Answers GET/POST paths with fixed JSON bodies. */
async function startJsonServer(
  routes: Record<string, unknown>,
): Promise<{ url: string; server: Server; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    hits.push(`${req.method} ${path}`);
    const body = routes[`${req.method} ${path}`];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, hits };
}

const servers: Server[] = [];
let h: AccountsHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('local model discovery', () => {
  it('reads Ollama /api/tags capabilities and context length, skipping embedding models', async () => {
    const ollama = await startJsonServer({
      'GET /api/tags': {
        models: [
          {
            model: 'qwen3:0.6b',
            details: { context_length: 40960 },
            capabilities: ['completion', 'tools', 'thinking'],
          },
          { model: 'qwen3-vl:8b', details: {}, capabilities: ['completion', 'vision', 'tools'] },
          { model: 'nomic-embed-text:latest', capabilities: ['embedding'] },
        ],
      },
    });
    servers.push(ollama.server);
    const found = await discoverLocalModels({ baseUrl: `${ollama.url}/v1`, kind: 'ollama' });
    expect(found).toEqual({
      ok: true,
      value: [
        { id: 'qwen3:0.6b', reasoning: true, vision: false, contextWindow: 40960 },
        { id: 'qwen3-vl:8b', reasoning: false, vision: true },
      ],
    });
  });

  it('asks /api/show when an older Ollama lists no capabilities', async () => {
    const ollama = await startJsonServer({
      'GET /api/tags': { models: [{ model: 'llama3.2:3b', details: {} }] },
      'POST /api/show': {
        capabilities: ['completion', 'tools'],
        model_info: { 'llama.context_length': 131072 },
      },
    });
    servers.push(ollama.server);
    const found = await discoverLocalModels({ baseUrl: `${ollama.url}/v1`, kind: 'ollama' });
    expect(found).toEqual({
      ok: true,
      value: [{ id: 'llama3.2:3b', reasoning: false, vision: false, contextWindow: 131072 }],
    });
    expect(ollama.hits).toEqual(['GET /api/tags', 'POST /api/show']);
  });

  it('lists LM Studio models through /v1/models', async () => {
    const lmStudio = await startJsonServer({
      'GET /v1/models': { data: [{ id: 'qwen/qwen3-4b' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] },
    });
    servers.push(lmStudio.server);
    const found = await discoverLocalModels({ baseUrl: `${lmStudio.url}/v1`, kind: 'openai-compatible' });
    expect(found).toEqual({ ok: true, value: [{ id: 'qwen/qwen3-4b' }] });
  });

  it('reports a server that is not running as models.local_server_unreachable', async () => {
    const found = await discoverLocalModels({
      baseUrl: 'http://127.0.0.1:9/v1',
      kind: 'ollama',
      timeoutMs: 1000,
    });
    expect(found).toMatchObject({
      ok: false,
      error: {
        code: 'models.local_server_unreachable',
        retryable: true,
        params: { endpoint: 'http://127.0.0.1:9/v1' },
      },
    });
  });

  it('keeps credentials in the URL or the failure out of the error', async () => {
    const secrets = ['supersecretvalue1', 'sk-thisisasecretkey1234567890', 'my-endpoint-key-123'];
    const refused = await discoverLocalModels({
      baseUrl: 'http://127.0.0.1:9/v1?client_secret=supersecretvalue1',
      kind: 'openai-compatible',
      fetch: async () => new Response('{}', { status: 401 }),
    });
    const thrown = await discoverLocalModels({
      baseUrl: 'http://127.0.0.1:9/v1',
      kind: 'openai-compatible',
      apiKey: 'my-endpoint-key-123',
      fetch: async () => {
        throw new Error('proxy said: Bearer sk-thisisasecretkey1234567890 (key my-endpoint-key-123)');
      },
    });
    for (const found of [refused, thrown]) {
      expect(found).toMatchObject({ ok: false, error: { code: 'models.local_server_unreachable' } });
      const text = JSON.stringify(found);
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    expect(!refused.ok && refused.error.detail).toContain('HTTP 401');
  });
});

describe('local endpoint configuration', () => {
  it('adds an endpoint that the next call uses, with an optional key, and removes it', async () => {
    h = await createAccountsHarness();
    const endpoint = {
      id: 'lmstudio',
      name: 'LM Studio',
      baseUrl: h.provider.openaiBaseUrl,
      models: [{ id: 'qwen/qwen3-4b' }],
    };
    for (const runtime of [h.mainRuntime, h.agentRuntime])
      expect(runtime.setEndpoint(endpoint)).toEqual({ ok: true, value: undefined });
    const call = {
      module: 'agent' as const,
      target: { provider: 'lmstudio', model: 'qwen/qwen3-4b' },
      messages: [{ role: 'user' as const, content: 'Hi' }],
    };

    const keyless = await h.client.complete(call);
    expect(keyless).toMatchObject({ ok: true, value: { local: true } });
    expect(h.callLog.records.at(-1)).toMatchObject({ provider: 'lmstudio', local: true, costUsd: 0 });

    // LM Studio can require a key; it is stored like any other and sent on the next call.
    const key = 'lm-studio-local-key-0123456789';
    expect((await h.broker.setApiKey('lmstudio', key, { skipTest: true })).ok).toBe(true);
    await h.client.complete(call);
    expect(h.provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${key}`);

    for (const runtime of [h.mainRuntime, h.agentRuntime]) runtime.removeEndpoint('lmstudio');
    expect(await h.client.complete(call)).toMatchObject({
      ok: false,
      error: { code: 'models.unknown_model' },
    });
  });

  it('refuses an endpoint that would shadow a cloud provider or has a bad URL', async () => {
    h = await createAccountsHarness();
    const base = { name: 'X', models: [] };
    expect(
      h.agentRuntime.setEndpoint({ ...base, id: 'openai', baseUrl: 'http://127.0.0.1:1/v1' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'models.endpoint_invalid', params: { field: 'id' } },
    });
    expect(h.agentRuntime.setEndpoint({ ...base, id: 'mine', baseUrl: 'file:///etc/passwd' })).toMatchObject({
      ok: false,
      error: { code: 'models.endpoint_invalid', params: { field: 'baseUrl' } },
    });
  });
});
