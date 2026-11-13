// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X5 (agent half): no media, secrets or paths in the agent's debug bundle
 * sections. A real run with an upload (consent and Always allow), a
 * contact-sheet artifact, a tool error carrying a key and a home path, then
 * the collector's sections checked as main's scan would: no home path, no
 * key, no base64 run, no artifact bytes; and with includeChatText the
 * message is there while paths still aren't.
 */
import {
  createMemorySettingsStore,
  debugSectionSchema,
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  unwrap,
  type CloudCallRecord,
  type DebugSection,
  type RunId,
} from '@taalcut/core';
import { createDebugBundleCollector, createMemoryConsentStore, debugBundleRouter } from '@taalcut/agent';
import { z } from 'zod';
import { connectRpc, debugBundleContract, serveRpc } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { cloudVisionModule } from './support/fixtures';
import { call, harness, plan, turns } from './support/harness';
import { channel } from './support/ports';

const HOME = '/Users/tester';
const CLIP = `${HOME}/Movies/goa/clip.mov`;
const KEY = `sk-proj-${'A1b2C3d4E5'.repeat(4)}`;
/** What a contact sheet's bytes look like in a tool output: a long base64 run. */
const SHEET = Buffer.alloc(30_000, 7).toString('base64');
/** The user pasted a key into the chat: it reaches the run log, so the bundle must scrub it. */
const MESSAGE = `Make a reel of my Goa trip from ${HOME}/Movies/goa please (my key: ${KEY})`;

function mediaModule() {
  return defineToolModule({
    id: 'media',
    tools: [
      defineTool({
        name: 'media.probe',
        version: '1.0.0',
        description: 'Reads the streams of a video file.',
        input: z.object({ path: z.string() }),
        output: z.object({ seconds: z.number() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async (input) =>
          err({
            code: 'media.probe_failed',
            messageKey: 'errors.media.probe_failed',
            retryable: false,
            detail: `ffprobe exited 1 on ${input.path} (OPENAI_API_KEY=${KEY})`,
          }),
      }),
      defineTool({
        name: 'media.contactSheet',
        version: '1.0.0',
        description: 'Makes a contact sheet of a video: one frame per shot, as a JPEG.',
        input: z.object({ path: z.string() }),
        output: z.object({ jpegBase64: z.string(), frames: z.number() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        summarize: (output) => `Contact sheet of ${CLIP}: ${output.frames} frames.`,
        run: async () => ok({ jpegBase64: SHEET, frames: 12 }),
      }),
    ],
  });
}

async function recordedRun() {
  const consents = createMemoryConsentStore();
  const h = harness({
    script: turns(
      plan('Look at the clip'),
      {
        toolCalls: [
          call('media_probe', { path: CLIP }),
          call('media_contactSheet', { path: CLIP }),
          call('vision_describeFrame', { path: CLIP, atSeconds: 1 }),
        ],
      },
      { text: `I looked at ${CLIP}: a drone shot over the beach.`, reasoning: 'The user wants a Goa reel.' },
    ),
    modules: [mediaModule(), cloudVisionModule()],
    deps: { consents, cloudProviders: () => ['google'] },
  });
  const paused = unwrap(await h.agent.run({ conversationId: 'c', message: MESSAGE }));
  expect(paused.pending).toMatchObject([{ kind: 'consent' }]);
  const done = unwrap(
    await h.agent.answer(paused.runId, {
      requestId: paused.pending[0]!.requestId,
      decision: 'approve',
      remember: true,
      note: `ok, send ${CLIP}`,
    }),
  );
  expect(done.status).toBe('completed');
  const calls: CloudCallRecord[] = [
    {
      id: '01JZZZZZZZZZZZZZZZZZZZZZZZ' as CloudCallRecord['id'],
      module: 'vision',
      provider: 'google',
      model: 'gemini-3-flash',
      reasoning: 'off',
      local: false,
      startedAt: Date.now(),
      latencyMs: 900,
      bytesSent: 210_000,
      bytesReceived: 800,
      inputTokens: 1200,
      outputTokens: 30,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.004,
      outcome: 'error',
      errorCode: 'models.rate_limited',
      httpStatus: 429,
      attempt: 1,
      runId: done.runId,
    },
  ];
  return { ...h, runId: done.runId, consents, calls };
}

function collectorFor(run: Awaited<ReturnType<typeof recordedRun>>) {
  return createDebugBundleCollector({
    log: { read: (runId: RunId) => run.store.read(runId) },
    recentRuns: async () => ok([run.runId]),
    cloudCalls: async () => ok(run.calls),
    settings: createMemorySettingsStore(),
    consents: run.consents,
    extraSettings: async () => ({
      autonomy: 'autopilot',
      budget: { maxUsd: 0.5 },
      keychainNote: `see ${HOME}/x`,
    }),
    home: HOME,
  });
}

const all = (sections: readonly DebugSection[]) => sections.map((s) => s.text).join('\n');

function expectClean(text: string) {
  expect(text).not.toContain(HOME);
  expect(text).not.toContain('/Users/');
  expect(text).not.toContain('Movies/goa');
  expect(text).not.toContain('sk-proj-');
  expect(text).not.toContain(SHEET.slice(0, 200));
  expect(text).not.toMatch(/[A-Za-z0-9+/]{1024,}/);
  expect(text).not.toContain('"native"');
}

describe('the debug bundle, agent half', () => {
  it('holds traces, redacted runs, cloud calls and settings, with no media, secrets or paths', async () => {
    const run = await recordedRun();
    const sections = unwrap(await collectorFor(run).collect({}));
    for (const section of sections) expect(debugSectionSchema.safeParse(section).success).toBe(true);
    expect(sections.map((s) => s.path)).toEqual([
      `agent/traces/${run.runId}.json`,
      `agent/runs/${run.runId}.jsonl`,
      'agent/cloud-calls.json',
      'agent/settings.json',
    ]);
    const text = all(sections);
    expectClean(text);
    // What makes a bundle useful stays: tool names, error codes, ids, numbers.
    expect(text).toContain('media.probe_failed');
    expect(text).toContain('vision.describeFrame');
    expect(text).toContain(run.runId);
    expect(text).toContain('<path:.mov>');
    expect(text).toContain('gen_ai.request.model');
    expect(text).toContain('models.rate_limited');
    // Chat text is gone by default: only its length and a hash.
    expect(text).not.toContain('Goa trip');
    expect(text).not.toContain('drone shot');
    expect(text).not.toContain('wants a Goa reel');
    expect(text).toMatch(/"redacted": ?"text"/);

    const runs = sections.find((s) => s.section === 'runs')!;
    expect(runs.redactions.text).toBeGreaterThan(0);
    expect(runs.redactions.paths).toBeGreaterThan(0);
    expect(runs.redactions.secrets).toBeGreaterThan(0);
    const events = runs.text
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
    const artifact = events.find(
      (e) => e.type === 'tool.completed' && (e.payload.output as { kind: string }).kind === 'artifact',
    );
    expect(artifact?.payload.output).toEqual({
      kind: 'artifact',
      ref: { id: expect.any(String), mediaType: 'application/json', bytes: expect.any(Number) },
    });
    const settings = JSON.parse(sections.find((s) => s.section === 'settings')!.text) as Record<
      string,
      unknown
    >;
    expect(settings).toMatchObject({
      autonomy: 'autopilot',
      localOnly: false,
      defaultProjectCap: { currency: 'USD', micros: 2_000_000 },
      standingConsents: [{ module: 'vision', providers: ['google'] }],
    });
  });

  it('with includeChatText keeps what was said, and still no paths or keys', async () => {
    const run = await recordedRun();
    const text = all(unwrap(await collectorFor(run).collect({ includeChatText: true })));
    expectClean(text);
    expect(text).toContain('Make a reel of my Goa trip from <path:> please');
    expect(text).toContain('a drone shot over the beach');
    expect(text).toContain('The user wants a Goa reel.');
  });

  it('takes the runs asked for, skips one the log no longer has, and serves the contract', async () => {
    const run = await recordedRun();
    const ports = channel();
    serveRpc(debugBundleRouter(collectorFor(run)), ports.port1, { context: {} });
    const client = connectRpc(debugBundleContract, ports.port2, { peer: 'main' }).client;
    const gone = '01J00000000000000000000000' as RunId;
    const sections = await client.collect({ runIds: [gone, run.runId] });
    expect(sections.filter((s) => s.section === 'runs').map((s) => s.path)).toEqual([
      `agent/runs/${run.runId}.jsonl`,
    ]);
  });
});
