// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineTool,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  rationalTimeJsonSchema,
  ulidSchema,
  unwrap,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { flowHarness } from './support/flow-harness';
import { call, ofType, plan, turns } from './support/harness';

const projectId = newId<'Project'>();
const assetId = newId<'Asset'>();
const duration = { value: 90, rate: { num: 1, den: 1 } };
const sources = [
  { kind: 'file', reference: '/selected/interview.mp4', input: { path: '/selected/interview.mp4' } },
  {
    kind: 'YouTube URL',
    reference: 'https://www.youtube.com/watch?v=interview01',
    input: { url: 'https://www.youtube.com/watch?v=interview01' },
  },
  { kind: 'library asset', reference: assetId, input: undefined },
];

/** Stand-ins isolate the generic agent loop; the desktop tests cover the real Shorts tools and ports. */
function shortTools() {
  const calls: { name: string; input: unknown }[] = [];
  const metadata = {
    version: '1.0.0',
    costClass: 'local' as const,
    sideEffect: 'read' as const,
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
  };
  const tools = defineToolModule({
    id: 'shorts',
    tools: [
      defineTool({
        ...metadata,
        name: 'shorts.createProject',
        description: 'Opens a project for a short extracted from a long video.',
        input: z.object({ name: z.string() }),
        output: z.object({ projectId: ulidSchema('Project') }),
        run: async (input) => {
          calls.push({ name: 'shorts.createProject', input });
          return ok({ projectId });
        },
      }),
      defineTool({
        ...metadata,
        name: 'shorts.importSource',
        description: 'Imports a local file or YouTube video for a source-excerpt short.',
        input: z.object({
          projectId: ulidSchema('Project'),
          path: z.string().optional(),
          url: z.url().optional(),
        }),
        output: z.object({ assetId: ulidSchema('Asset'), sourceUrl: z.url().optional() }),
        run: async (input) => {
          calls.push({ name: 'shorts.importSource', input });
          return ok({ assetId, ...(input.url ? { sourceUrl: input.url } : {}) });
        },
      }),
      defineTool({
        ...metadata,
        name: 'shorts.generate',
        description:
          'Extracts a faithful portrait short from a source asset, with editable timeline and exports.',
        input: z.object({
          projectId: ulidSchema('Project'),
          assetId: ulidSchema('Asset'),
          sourceUrl: z.url().optional(),
          duration: rationalTimeJsonSchema,
        }),
        output: z.object({ status: z.literal('ready') }),
        run: async (input) => {
          calls.push({ name: 'shorts.generate', input });
          return ok({ status: 'ready' as const });
        },
      }),
    ],
  });
  return { tools, calls };
}

describe('source-excerpt Shorts use the main agent tool loop', () => {
  it.each(sources)('$kind bypasses remix skills and keeps the source and duration', async (source) => {
    const stub = shortTools();
    const imported = Boolean(source.input);
    const generate = {
      projectId,
      assetId,
      duration,
      ...(source.input?.url ? { sourceUrl: source.input.url } : {}),
    };
    const h = flowHarness({
      extra: { tools: [stub.tools] },
      deps: { contextWindow: () => 8_192 },
      script: turns(
        plan('Extract a short: shorts.createProject shorts.importSource shorts.generate'),
        {
          toolCalls: [
            call('findTools', { query: 'shorts.createProject shorts.importSource shorts.generate' }),
          ],
        },
        ...(imported
          ? [
              { toolCalls: [call('shorts_createProject', { name: 'Interview short' })] },
              { toolCalls: [call('shorts_importSource', { projectId, ...source.input })] },
            ]
          : []),
        { toolCalls: [call('shorts_generate', generate)] },
        { text: 'The editable short and exports are ready.' },
      ),
    });
    const outcome = unwrap(
      await h.agent.run({
        conversationId: 'shorts',
        ...(!imported ? { projectId } : {}),
        message: `Create one best portrait short for YouTube Shorts and Instagram Reels, with a target of 90 seconds. Find a complete hook, context and payoff in this source. Source: ${source.reference}`,
      }),
    );
    expect(outcome.status).toBe('completed');
    const first = h.models.requests[0]!;
    expect(first.system).toContain('shorts: shorts.generate:');
    expect(first.system).toContain('When shorts.generate is listed in the Tool catalogue');
    expect(first.system).toContain('use findTools to load the shorts tools if they are not yet offered');
    expect(first.system).toContain('call updatePlan on your first turn with plain steps, without a skill');
    expect(first.system).toContain(
      'use shorts.importSource for a file or URL, or reuse the supplied library assetId',
    );
    expect(first.system).toContain('then call shorts.generate');
    expect(first.system).toContain('This source-excerpt request does not use startFlow');
    expect(first.system).toContain('For other requests to make a video, call startFlow');
    expect(first.tools?.map((tool) => tool.name)).toEqual(['updatePlan', 'startFlow']);
    expect(h.models.requests[2]?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['shorts_createProject', 'shorts_importSource', 'shorts_generate']),
    );
    expect(stub.calls).toEqual([
      ...(imported
        ? [
            { name: 'shorts.createProject', input: { name: 'Interview short' } },
            { name: 'shorts.importSource', input: { projectId, ...source.input } },
          ]
        : []),
      { name: 'shorts.generate', input: generate },
    ]);
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'route.chosen')[0]?.payload).toMatchObject({ window: 8_192 });
    expect(ofType(events, 'flow.started')).toHaveLength(0);
    expect(ofType(events, 'skill.entered')).toHaveLength(0);
    expect(ofType(events, 'tool.failed')).toHaveLength(0);
    expect(h.world.calls).toEqual([]);
  });
});
