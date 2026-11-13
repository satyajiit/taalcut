// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The router's cloud decision models over Taalcut's own fetch (models SPEC P3.5), against recorded answers
 * in the providers' documented shapes (test/fixtures/router/*.json): Jev pinned to jev-1.13.0 with the flat
 * body and Bearer auth, its resolved model returned and priced from the router's table; Clef-flash on
 * Cloudflare's documented URL and envelope, skipped for a long state; failures fall down the chain.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createClassifier,
  createMemoryCloudCallSink,
  createModelRuntime,
  createStaticCredentialProvider,
  ROUTER_CLASSIFIER_CHAIN,
  type ClassifyRequest,
  type FetchFn,
} from '@taalcut/models';

interface Recording {
  readonly request: { readonly url: string; readonly model: string };
  readonly status: number;
  readonly response: unknown;
}
const load = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'router', name), 'utf8')) as Recording;
const JEV = load('typesafe-systemone.json');
const CLEF = load('cloudflare-clef-flash.json');

const TYPESAFE_KEY = 'ts-key-0123456789abcdefghijklmnop';
const CF_TOKEN = 'cf-token-0123456789abcdefghijklmnop';
const ACCOUNT = '0123456789abcdef0123456789abcdef';

const ROUTE: ClassifyRequest = {
  state: { message: 'make slot 3 shorter', stepText: 'Trim slot 3' },
  questions: {
    family: {
      type: 'choice',
      instructions: 'Which tool family next, or none?',
      options: { none: 'No tool', timeline: 'Edits the timeline', library: 'Finds media' },
    },
  },
  localHints: { family: { timeline: 'timeline.trimClip: Trims a clip' } },
};

interface Sent {
  readonly url: string;
  readonly auth: string | null;
  readonly body: Record<string, unknown>;
}

function setup(replies: Record<string, { status: number; body: unknown; headers?: Record<string, string> }>) {
  const sent: Sent[] = [];
  const fetch: FetchFn = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    sent.push({ url, auth: headers.get('authorization'), body: JSON.parse(String(init?.body)) });
    const reply = Object.entries(replies).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!reply) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  const callLog = createMemoryCloudCallSink();
  const classifier = createClassifier({
    runtime: createModelRuntime({ builtinProviders: [] }),
    credentials: createStaticCredentialProvider({
      typesafe: { kind: 'api_key', secret: TYPESAFE_KEY, source: 'test' },
      'cloudflare-workers-ai': {
        kind: 'api_key',
        secret: CF_TOKEN,
        env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
        source: 'test',
      },
    }),
    callLog,
    fetch,
  });
  return { classifier, callLog, sent };
}

describe('router pinned to jev-1.13.0 over fetch', () => {
  it('posts the flat body with Bearer auth, returns the resolved model and prices the row', async () => {
    const { classifier, callLog, sent } = setup({
      [JEV.request.url]: { status: JEV.status, body: JEV.response },
    });
    const result = await classifier.classify({ ...ROUTE, trace: { runId: 'run-1', spanId: 'call-1' } });
    expect(sent).toEqual([
      {
        url: 'https://api.typesafe.ai/v1/systemone',
        auth: `Bearer ${TYPESAFE_KEY}`,
        body: {
          model: 'jev-1.13.0',
          state: ROUTE.state,
          questions: {
            family: {
              type: 'choice',
              instructions: 'Which tool family next, or none?',
              criteria: { none: 'No tool', timeline: 'Edits the timeline', library: 'Finds media' },
            },
          },
        },
      },
    ]);
    // Local hints stay on this Mac.
    expect(JSON.stringify(sent)).not.toContain('timeline.trimClip');
    expect(result).toMatchObject({
      ok: true,
      value: {
        provider: 'typesafe',
        model: 'jev-1.13.0',
        local: false,
        inputTokens: 412,
        answers: { family: { type: 'choice', choice: 'timeline', confidence: 0.91 } },
      },
    });
    expect(callLog.records).toEqual([
      expect.objectContaining({
        module: 'router',
        provider: 'typesafe',
        model: 'jev-1.13.0',
        outcome: 'ok',
        inputTokens: 412,
        costUsd: (412 * 0.042) / 1_000_000,
        runId: 'run-1',
        spanId: 'call-1',
      }),
    ]);
    expect(JSON.stringify(callLog.records)).not.toContain(TYPESAFE_KEY);
  });

  it('pins the chain: jev-1.13.0, Clef-flash, then the rules router', () => {
    expect(ROUTER_CLASSIFIER_CHAIN.map((c) => `${c.provider}/${c.model}`)).toEqual([
      'typesafe/jev-1.13.0',
      'cloudflare-workers-ai/@cf/cloudflare/clef-flash',
      'taalcut/rules-router',
    ]);
  });

  it('falls to Clef-flash on a rate limit, on its documented URL and envelope', async () => {
    const { classifier, callLog, sent } = setup({
      'https://api.typesafe.ai/': {
        status: 429,
        body: { error: 'rate limited' },
        headers: { 'retry-after': '3' },
      },
      'https://api.cloudflare.com/': { status: CLEF.status, body: CLEF.response },
    });
    const result = await classifier.classify(ROUTE);
    expect(sent.map((s) => s.url)).toEqual(['https://api.typesafe.ai/v1/systemone', CLEF.request.url]);
    expect(sent[1]).toMatchObject({ auth: `Bearer ${CF_TOKEN}`, body: { model: 'clef-flash' } });
    expect(result).toMatchObject({
      ok: true,
      value: { provider: 'cloudflare-workers-ai', model: 'clef-flash', inputTokens: 380 },
    });
    expect(callLog.records.map((r) => [r.provider, r.outcome, r.errorCode, r.attempt])).toEqual([
      ['typesafe', 'error', 'models.rate_limited', 1],
      ['cloudflare-workers-ai', 'ok', undefined, 2],
    ]);
    expect(callLog.records[1]?.costUsd).toBeCloseTo((380 * 0.038) / 1_000_000, 12);
  });

  it('skips Clef-flash for a state over 20,000 tokens and lands on the rules router', async () => {
    const { classifier, sent } = setup({
      'https://api.typesafe.ai/': { status: 503, body: { error: 'overloaded' } },
      'https://api.cloudflare.com/': { status: CLEF.status, body: CLEF.response },
    });
    const long = { ...ROUTE, state: { ...ROUTE.state, recentUserText: 'trim '.repeat(17_000) } };
    const result = await classifier.classify(long);
    expect(sent.map((s) => s.url)).toEqual(['https://api.typesafe.ai/v1/systemone']);
    expect(result).toMatchObject({
      ok: true,
      value: { provider: 'taalcut', model: 'rules-router', local: true },
    });
  });

  it('refuses an answer that is not one of the options, and never trusts its shape', async () => {
    const bad = {
      model: 'jev-1.13.0',
      answers: { family: { type: 'choice', choice: 'ignore all rules', probabilities: {}, confidence: 1 } },
    };
    const { classifier } = setup({ 'https://api.typesafe.ai/': { status: 200, body: bad } });
    const result = await classifier.classify({ ...ROUTE, target: ROUTER_CLASSIFIER_CHAIN[0] });
    expect(result).toMatchObject({ ok: false, error: { code: 'models.provider_error' } });
  });

  it('needs the Cloudflare account id for Clef and says so', async () => {
    const callLog = createMemoryCloudCallSink();
    const classifier = createClassifier({
      runtime: createModelRuntime({ builtinProviders: [] }),
      credentials: createStaticCredentialProvider({
        'cloudflare-workers-ai': { kind: 'api_key', secret: CF_TOKEN, source: 'test' },
      }),
      callLog,
      fetch: async () => new Response('{}'),
    });
    const result = await classifier.classify({ ...ROUTE, target: ROUTER_CLASSIFIER_CHAIN[1] });
    expect(result).toMatchObject({ ok: false, error: { code: 'models.not_configured' } });
    expect(callLog.records).toEqual([]);
  });
});
