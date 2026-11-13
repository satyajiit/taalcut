// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G6 "Done when", part 1: SOUL.md is in the system prompt for every
 * provider family. The agent runs against the real @taalcut/models client
 * (pi-ai's real request builders) with a fetch that captures the HTTP body
 * and answers 400, so nothing leaves the machine; each family's wire format
 * is snapshotted with the soul replaced by a marker, and the soul is checked
 * verbatim in the slot that family uses for the system prompt.
 */
import { ok, unwrap } from '@taalcut/core';
import { parseSoul, systemPrompt } from '@taalcut/agent';
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  OLLAMA_DEFAULT_BASE_URL,
  type ModelChoice,
} from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { clipsModule } from './support/fixtures';
import { harness, registryFor, SOUL } from './support/harness';

const FAMILIES: readonly {
  family: string;
  choice: ModelChoice;
  systemOf: (body: Record<string, unknown>) => unknown;
}[] = [
  {
    family: 'OpenAI Responses (ChatGPT plan, API key)',
    choice: { provider: 'openai', model: 'gpt-5.4' },
    // pi-ai 1.4.0 declares the tools first, in an `additional_tools` item, as Codex does.
    systemOf: (b) => (b.input as { type?: string }[]).find((item) => item.type !== 'additional_tools'),
  },
  {
    family: 'Anthropic Messages',
    choice: { provider: 'anthropic', model: 'claude-sonnet-5' },
    systemOf: (b) => (b.system as { text: string }[])[0],
  },
  {
    family: 'Chat Completions, local (Ollama)',
    choice: { provider: 'ollama', model: 'qwen3:0.6b' },
    systemOf: (b) => (b.messages as unknown[])[0],
  },
  {
    family: 'Mistral',
    choice: { provider: 'mistral', model: 'devstral-2512' },
    systemOf: (b) => (b.messages as unknown[])[0],
  },
  {
    family: 'xAI (Responses)',
    choice: { provider: 'xai', model: 'grok-4.5' },
    systemOf: (b) => (b.input as unknown[])[0],
  },
];

function capturingClient(choice: ModelChoice) {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const runtime = createModelRuntime({
    endpoints: [
      {
        id: 'ollama',
        name: 'Ollama',
        baseUrl: OLLAMA_DEFAULT_BASE_URL,
        models: [{ id: 'qwen3:0.6b', reasoning: true }],
      },
    ],
  });
  const secret = { kind: 'api_key' as const, secret: 'sk-test-0123456789', source: 'test' };
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider({
      openai: secret,
      anthropic: secret,
      mistral: secret,
      xai: secret,
    }),
    callLog: createMemoryCloudCallSink(),
    selector: { resolve: (module) => ok({ module, choices: [choice] }) },
    retry: { maxRetries: 0 },
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      bodies.push({
        url: `${url.host}${url.pathname}`,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({ error: { message: 'captured by the test', type: 'invalid_request_error' } }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  });
  return { client, bodies };
}

describe('the soul in every provider family’s system prompt', () => {
  it.each(FAMILIES)('$family', async ({ choice, systemOf }) => {
    const { client, bodies } = capturingClient(choice);
    const h = harness({ script: () => ({ text: 'unused' }), deps: { models: client } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make a reel from my trip.' }));
    // The provider "rejected" the call, so the run fails cleanly, with the request already captured.
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'models.bad_request' } });
    expect(bodies).toHaveLength(1);

    const slot = JSON.stringify(systemOf(bodies[0]!.body));
    expect(slot).toContain(JSON.stringify(SOUL.text).slice(1, -1));
    const shape = JSON.parse(
      JSON.stringify(bodies[0]).replaceAll(
        JSON.stringify(SOUL.text).slice(1, -1),
        `<SOUL.md v${SOUL.version}>`,
      ),
    );
    expect(shape).toMatchSnapshot();
  });
});

describe('prompt assembly', () => {
  it('follows the cover brief and requires actual composition, saved output and visual review', () => {
    const catalogue = registryFor([clipsModule()]).catalogue();
    const prompt = systemPrompt(SOUL, [{ ...catalogue[0]!, family: 'images' }]);
    expect(prompt).toContain('workspace.docs topic taalcut/hallmark-thumbnails');
    expect(prompt).toContain('its design field supports editable typography');
    expect(prompt).toContain('inspect the saved image before claiming it is ready');
    expect(prompt).toContain('supported ChatGPT or Grok sign-ins');
    expect(prompt).toContain('do not force footage or photorealism');
    expect(prompt).toContain('image generation is not a prerequisite');
  });

  it('puts the soul first, verbatim, then the rules and the catalogue', () => {
    const prompt = systemPrompt(SOUL, registryFor([clipsModule()]).catalogue());
    expect(prompt.startsWith(SOUL.text)).toBe(true);
    expect(prompt).toContain('# How you work in Taalcut');
    expect(prompt).toContain('in your response text, in the same turn as the tool calls');
    expect(prompt).toContain(
      'invent findings, expose private reasoning, or add a model turn just for an update',
    );
    expect(prompt).toContain('<untrusted source="…">');
    expect(prompt.split('\n').filter((line) => line.startsWith('clips: '))).toHaveLength(9);
    expect(SOUL.version).toBe('1.0.0');
  });

  it('reads the soul version from the front matter', () => {
    expect(parseSoul('---\nname: x\nversion: 2.3.0\n---\n\n# Soul').version).toBe('2.3.0');
    expect(parseSoul('# No front matter').version).toBe('unversioned');
  });

  it('records the soul version and catalogue hash in run.started', async () => {
    const h = harness({ script: () => ({ text: 'Hi.' }) });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'hi' }));
    const started = (await h.events(outcome.runId))[0];
    expect(started).toMatchObject({
      type: 'run.started',
      payload: { soulVersion: '1.0.0', catalogueHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
  });
});
