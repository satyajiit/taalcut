// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The router classifier against a local server that speaks TypeSafe's System One
 * protocol (spike 04): TypeSafe over Taalcut's own fetch, OpenRouter through pi-ai.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createClassifier,
  createMemoryCloudCallSink,
  createModelRuntime,
  createStaticCredentialProvider,
  ROUTER_CLASSIFIER_CHAIN,
  type ClassifyRequest,
} from '@taalcut/models';

const KEY = 'ts-live-key-0123456789abcdefghij';
const ROUTE: ClassifyRequest = {
  state: { message: 'Cut the silences from the second clip' },
  questions: {
    family: {
      type: 'choice',
      instructions: 'Which tool family does the request need?',
      options: { none: 'No tool', timeline: 'Edits the timeline', library: 'Finds media' },
    },
    tool: {
      type: 'bool',
      instructions: 'Does this need a tool?',
      yes: 'A tool is needed',
      no: 'Just answer',
    },
  },
};

let server: Server;
let url: string;
let bodies: Record<string, unknown>[];
let status: number;

beforeEach(async () => {
  bodies = [];
  status = 200;
  server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (part: Buffer) => parts.push(part));
    req.on('end', () => {
      bodies.push({
        path: req.url,
        auth: req.headers.authorization,
        ...JSON.parse(Buffer.concat(parts).toString()),
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          status === 200
            ? {
                answers: {
                  family: {
                    type: 'choice',
                    choice: 'timeline',
                    probabilities: { none: 0.05, timeline: 0.9, library: 0.05 },
                    confidence: 0.9,
                  },
                  tool: { type: 'noul', noul: 0.97 },
                },
                usage: { input_tokens: 120, output_tokens: 0 },
              }
            : { error: { message: `bad key ${KEY}` } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function classifier(credentials: Record<string, string>) {
  const runtime = createModelRuntime({
    builtinProviders: ['typesafe', 'cloudflare-workers-ai', 'openrouter'],
    baseUrlOverrides: { typesafe: `${url}/v1/`, openrouter: `${url}/openrouter/v1` },
  });
  const callLog = createMemoryCloudCallSink();
  const entries = Object.entries(credentials).map(([provider, secret]) => [
    provider,
    { kind: 'api_key' as const, secret, source: 'test' },
  ]);
  const c = createClassifier({
    runtime,
    credentials: createStaticCredentialProvider(Object.fromEntries(entries)),
    callLog,
    chain: [ROUTER_CLASSIFIER_CHAIN[0]!, { provider: 'openrouter', model: '~typesafe/jev-latest' }],
  });
  return { c, callLog };
}

describe('router classifier', () => {
  it('puts Jev (pinned) first, Clef-flash second and the rules router last, as spike 04 decided', () => {
    expect(ROUTER_CLASSIFIER_CHAIN).toEqual([
      { provider: 'typesafe', model: 'jev-1.13.0' },
      { provider: 'cloudflare-workers-ai', model: '@cf/cloudflare/clef-flash' },
      { provider: 'taalcut', model: 'rules-router' },
    ]);
  });

  it('asks Jev in one request and returns Taalcut-shaped answers with a cloud-call row', async () => {
    const { c, callLog } = classifier({ typesafe: KEY });
    const result = await c.classify(ROUTE);
    expect(result).toMatchObject({
      ok: true,
      value: {
        provider: 'typesafe',
        model: 'jev-1.13.0',
        answers: {
          family: { type: 'choice', choice: 'timeline', confidence: 0.9 },
          tool: { type: 'bool', probability: 0.97 },
        },
        inputTokens: 120,
      },
    });
    expect(bodies).toEqual([
      expect.objectContaining({
        path: '/v1/systemone',
        auth: `Bearer ${KEY}`,
        model: 'jev-1.13.0',
        state: ROUTE.state,
        questions: expect.objectContaining({ tool: expect.objectContaining({ type: 'noul' }) }),
      }),
    ]);
    expect(callLog.records).toEqual([
      expect.objectContaining({ module: 'router', provider: 'typesafe', outcome: 'ok', inputTokens: 120 }),
    ]);
  });

  it('moves down the chain when the first classifier is not set up', async () => {
    const { c } = classifier({ openrouter: KEY });
    const result = await c.classify(ROUTE);
    expect(result).toMatchObject({ ok: true, value: { provider: 'openrouter' } });
    expect(bodies[0]?.path).toBe('/openrouter/v1/systemone');
  });

  it('reports a refused key as models.auth_invalid without the key', async () => {
    status = 401;
    const { c, callLog } = classifier({ typesafe: KEY });
    const result = await c.classify({ ...ROUTE, target: ROUTER_CLASSIFIER_CHAIN[0]! });
    expect(result).toMatchObject({ ok: false, error: { code: 'models.auth_invalid' } });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(callLog.records[0]).toMatchObject({ outcome: 'error', httpStatus: 401 });
  });
});
