// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  ConflictError,
  err,
  newId,
  NotFoundError,
  ok,
  toolModuleProblems,
  type AnyTool,
  type CommandToolContext,
  type TextTranslator,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { translateToolModule, type TranslateToolDeps } from '../../src/tools/translate-tools';
import { createCaptionTranslator } from '../../src/translate/caption-translator';
import { memoryTimelineStore } from '../helpers/bus';
import { captionedTimeline, ENGLISH_CUES, recordedTranslator } from './captions';
import { RECORDED_TRANSLATIONS } from './recorded';

function deps(placement: ReturnType<TextTranslator['placement']>, timelines = memoryTimelineStore()) {
  const translator = recordedTranslator(RECORDED_TRANSLATIONS, { placement });
  const built: TranslateToolDeps = {
    captions: createCaptionTranslator({ translator }),
    translator,
    timelines,
    estimate: () => ({ usd: 0.004, basis: 'test price' }),
  };
  return built;
}

function onlyTool(
  placement: ReturnType<TextTranslator['placement']>,
  timelines = memoryTimelineStore(),
): AnyTool {
  const module = translateToolModule(deps(placement, timelines));
  expect(toolModuleProblems(module)).toEqual([]);
  const tool = module.tools[0];
  if (!tool) throw new Error('no tool');
  return tool;
}

function context(
  dispatched: unknown[],
  options: { readonly usage?: unknown[]; readonly placeFails?: boolean } = {},
): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: {
      put: async () => err(NotFoundError({ entity: 'artifact' })),
      get: async () => err(NotFoundError({ entity: 'artifact' })),
    },
    reportUsage: (usage) => void options.usage?.push(usage),
    reportProgress: () => undefined,
    dispatch: async (payload) => {
      dispatched.push(payload);
      return options.placeFails ? err(ConflictError({ entity: 'timeline' })) : ok({ cues: 6 });
    },
  };
}

describe('captions.translate', () => {
  it('is offered as the cloud write before a model is chosen, so a model chosen later finds it', () => {
    const tool = translateToolModule(deps('off')).tools[0];
    expect(tool).toMatchObject({
      costClass: 'cloud',
      permission: { network: 'internet', cloudModules: ['agent'] },
    });
  });

  it('is a local write on this Mac', () => {
    const tool = onlyTool('local');
    expect(tool).toMatchObject({
      name: 'captions.translate',
      version: '1.0.0',
      // Not in the `captions` family the Editor loads for caption fixes.
      family: 'translation',
      costClass: 'local',
      sideEffect: 'write',
      command: CAPTION_COMMANDS.applyTranslation,
      timeoutMs: 120_000,
      retry: { maxAttempts: 1 },
      permission: { network: 'none' },
    });
    expect(tool.estimateCost).toBeUndefined();
  });

  it('is a cloud write under the agent module, with an estimate, when the chain is in the cloud', () => {
    const tool = onlyTool('cloud');
    expect(tool).toMatchObject({
      costClass: 'cloud',
      sideEffect: 'write',
      permission: { network: 'internet', cloudModules: ['agent'] },
    });
    const input = tool.input.parse({
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      language: 'hi',
    });
    expect(tool.estimateCost?.(input)).toEqual({ usd: 0.004, basis: 'test price' });
  });

  it('keys repeats on the target, the language and the revision', () => {
    const tool = onlyTool('local');
    const base = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
    const key = (extra: object) => tool.idempotencyKey?.(tool.input.parse({ ...base, ...extra }));
    expect(key({ language: 'hi' })).toBe(key({ language: 'hi' }));
    expect(key({ language: 'hi' })).not.toBe(key({ language: 'es' }));
    expect(key({ language: 'hi', revision: 2 })).not.toBe(key({ language: 'hi', revision: 3 }));
  });

  it('dispatches captions.applyTranslation with every cue and reports counts', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const tool = onlyTool('local', memoryTimelineStore(timeline));
    const dispatched: unknown[] = [];
    const input = tool.input.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      language: 'pt-BR',
    });
    const done = await tool.run(input, context(dispatched));
    expect(done.ok ? tool.output.parse(done.value) : done.error.code).toEqual({
      cues: 6,
      shortened: 0,
      model: 'qwen3.5-4b',
      local: true,
    });
    expect(dispatched).toHaveLength(1);
    const payload = captionCommandPayloads[CAPTION_COMMANDS.applyTranslation].parse(dispatched[0]);
    expect(payload).toMatchObject({
      timelineId: timeline.id,
      revision: timeline.revision,
      language: 'pt-BR',
    });
    expect(payload.cues).toHaveLength(6);
  });

  // Review M8: a cloud translation's tokens and money reach the cost card, reported before the apply, so an apply
  // that fails still counts what the model calls cost (and the executor keeps that error, review H2).
  it('reports what the cloud calls used before it applies them, even when the apply fails', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const tool = onlyTool('cloud', memoryTimelineStore(timeline));
    const usage: unknown[] = [];
    const input = tool.input.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      language: 'es',
    });
    const done = await tool.run(input, context([], { usage, placeFails: true }));
    expect(done.ok ? 'ok' : done.error.code).toBe('core.conflict');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: 'cloud', model: 'recorded-cloud' });
    const reported = usage[0] as { usd: number; inputTokens: number; outputTokens: number };
    expect(reported.usd).toBeGreaterThan(0);
    expect(reported.inputTokens).toBeGreaterThan(0);
    expect(reported.outputTokens).toBeGreaterThan(0);
  });

  it('refuses a stale revision before translating anything', async () => {
    const timeline = captionedTimeline('en', ENGLISH_CUES);
    const tool = onlyTool('local', memoryTimelineStore(timeline));
    const dispatched: unknown[] = [];
    const input = tool.input.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      language: 'es',
      revision: timeline.revision + 1,
    });
    const done = await tool.run(input, context(dispatched));
    expect(done.ok ? 'ok' : done.error.code).toBe('core.conflict');
    expect(dispatched).toEqual([]);
  });
});
