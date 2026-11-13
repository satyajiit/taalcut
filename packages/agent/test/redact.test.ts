// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Redaction for the debug bundle, piece by piece: event types the redactor
 * doesn't know, history turns and plan steps (words go, ids stay), media
 * whatever the mode, paths in every form, and a run log too big for one
 * section (the oldest lines go, and the cut is noted).
 */
import { createMemorySettingsStore, err, ok, unwrap, type RunId, type SettingsStore } from '@taalcut/core';
import {
  createDebugBundleCollector,
  createMemoryConsentStore,
  createRedactor,
  redactRunEvent,
  type AgentEvent,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

const HOME = '/Users/tester';

describe('redactRunEvent', () => {
  const at = 1;
  const runId = '01J00000000000000000000001' as RunId;

  it('treats an event type it does not know as tool data: words go, ids and tokens stay', () => {
    const unknown = {
      runId,
      seq: 3,
      type: 'skill.handedOff',
      v: 1,
      at,
      payload: {
        skill: 'templates.analyst',
        templateId: runId,
        title: 'My Goa trip',
        url: 'https://www.instagram.com/reel/abc',
        file: 'beach.mov',
      },
    } as never;
    const { event, counts } = redactRunEvent(unknown, { includeChatText: false, home: HOME });
    expect(event.payload).toMatchObject({
      skill: 'templates.analyst',
      templateId: runId,
      title: { redacted: 'text', chars: 11 },
      file: '<path:.mov>',
    });
    expect(JSON.stringify(event)).not.toContain('instagram');
    expect(counts.paths).toBe(1);
  });

  it("a handOff call's handoff loses its words; an estimate keeps its numbers", () => {
    const handOff = {
      runId,
      seq: 4,
      type: 'tool.completed',
      v: 1,
      at,
      payload: { toolCallId: 'c1', handoff: { text: 'A reel of my Goa trip', targetSeconds: 30 } },
    } as never;
    expect(redactRunEvent(handOff, { includeChatText: false, home: HOME }).event.payload).toMatchObject({
      toolCallId: 'c1',
      handoff: { text: { redacted: 'text', chars: 21 }, targetSeconds: 30 },
    });
    const estimate = {
      runId,
      seq: 5,
      type: 'estimate.recorded',
      v: 1,
      at,
      payload: { estimateId: 'e1', labelKey: 'skills.x', estimate: { usd: 0.02, tokens: 900 }, lines: [] },
    } as never;
    expect(redactRunEvent(estimate, { includeChatText: false, home: HOME }).event.payload).toEqual({
      estimateId: 'e1',
      labelKey: 'skills.x',
      estimate: { usd: 0.02, tokens: 900 },
      lines: [],
    });
  });

  it('drops data: URLs and long base64 whatever the mode', () => {
    const r = createRedactor({ includeChatText: true, home: HOME });
    expect(r.string('data:image/png;base64,iVBORw0KGgo=', 'keep')).toEqual({ redacted: 'binary', chars: 34 });
    expect(r.value({ a: 'x'.repeat(2000) }, 'keep')).toEqual({ a: { redacted: 'binary', chars: 2000 } });
    expect(
      r.string('see ~/Desktop/a.png and file:///tmp/b.wav, then /Volumes/Card/DCIM/c.MOV.', 'keep'),
    ).toBe('see <path:.png> and <path:.wav>, then <path:.mov>.');
    expect(r.string('https://example.com/a/b stays', 'keep')).toBe('https://example.com/a/b stays');
  });
});

describe('nested words and ids', () => {
  const runId = '01J00000000000000000000002' as RunId;

  it('history turns and plan steps lose their words and keep their ids', () => {
    const started = {
      runId,
      seq: 0,
      type: 'run.started',
      v: 1,
      at: 1,
      payload: {
        conversationId: 'c',
        message: 'And now a shorter one',
        history: {
          turns: [
            {
              runId,
              user: 'Make a reel of Goa',
              tools: ['- media.probe (done)'],
              answer: 'Done.',
              status: 'completed',
              provider: 'openai',
            },
          ],
          trimmed: { runIds: [runId], tokens: 400 },
        },
      },
    } as unknown as AgentEvent;
    const { event } = redactRunEvent(started, { includeChatText: false, home: HOME });
    const history = (event.payload as { history: { turns: Record<string, unknown>[]; trimmed: unknown } })
      .history;
    expect(history.trimmed).toEqual({ runIds: [runId], tokens: 400 });
    expect(history.turns[0]).toMatchObject({
      runId,
      status: 'completed',
      provider: 'openai',
      user: { redacted: 'text', chars: 18 },
      answer: { redacted: 'text', chars: 5 },
    });

    const planned = {
      runId,
      seq: 1,
      type: 'plan.created',
      v: 1,
      at: 1,
      payload: {
        steps: [
          {
            id: 's1',
            text: 'Cast my Goa shots',
            skill: 'timeline.librarian',
            input: { projectId: runId, brief: 'goa trip vlog' },
          },
          { id: 's2', text: '' },
        ],
      },
    } as unknown as AgentEvent;
    const plan = redactRunEvent(planned, { includeChatText: false, home: HOME }).event.payload as {
      steps: Record<string, unknown>[];
    };
    expect(plan.steps[0]).toMatchObject({
      id: 's1',
      skill: 'timeline.librarian',
      text: { redacted: 'text' },
      input: { projectId: runId, brief: { redacted: 'text' } },
    });
    expect(plan.steps[1]).toEqual({ id: 's2', text: '' });
  });
});

describe('a run log over the section limit', () => {
  it('drops the oldest lines and notes how many', async () => {
    const runId = '01J00000000000000000000003' as RunId;
    const huge = 'word '.repeat(1_800_000);
    const events = [
      { runId, seq: 0, type: 'run.started', v: 1, at: 1, payload: { conversationId: 'c', message: huge } },
      { runId, seq: 1, type: 'run.completed', v: 1, at: 2, payload: { report: 'ok', did: [] } },
    ] as unknown as AgentEvent[];
    const collector = createDebugBundleCollector({
      log: { read: async () => ok(events) },
      recentRuns: async () => ok([runId]),
      cloudCalls: async () => ok([]),
      settings: createMemorySettingsStore(),
      consents: createMemoryConsentStore(),
      home: HOME,
      now: () => 10,
    });
    const sections = unwrap(await collector.collect({ includeChatText: true }));
    const runs = sections.find((s) => s.section === 'runs')!;
    const lines = runs.text.split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ truncated: 1 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: 'run.completed' });
  });
});

describe('a collector whose stores fail', () => {
  const broken = { code: 'library.database_failed', messageKey: 'x', retryable: true };
  const base = {
    log: { read: async () => ok([]) },
    recentRuns: async () => ok([]),
    cloudCalls: async () => ok([]),
    settings: createMemorySettingsStore(),
    consents: createMemoryConsentStore(),
    home: HOME,
  };

  it('returns the store error as a value, never a half bundle', async () => {
    const runs = await createDebugBundleCollector({ ...base, recentRuns: async () => err(broken) }).collect(
      {},
    );
    expect(!runs.ok && runs.error.code).toBe('library.database_failed');
    const calls = await createDebugBundleCollector({ ...base, cloudCalls: async () => err(broken) }).collect(
      {},
    );
    expect(!calls.ok && calls.error.code).toBe('library.database_failed');
    const settings: SettingsStore = { ...base.settings, get: async () => err(broken) };
    const read = await createDebugBundleCollector({ ...base, settings }).collect({});
    expect(!read.ok && read.error.code).toBe('library.database_failed');
  });
});
