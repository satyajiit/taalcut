// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G1 "Done when": a tool added in a domain package appears to the agent
 * with no change to packages/agent.
 *
 * `agentTurn` below stands in for packages/agent. It is written once, knows no
 * tool by name, and uses only the agent-facing ports (ToolCatalogue and
 * ToolExecutor). The only thing that changes between "before" and "after" is
 * the module list the composition root passes to createToolRegistry().
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap, type RunId } from '@taalcut/core';
import {
  createToolExecutor,
  createToolRegistry,
  formatCatalogue,
  type ToolCatalogue,
  type ToolExecutor,
  type ToolSchema,
} from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { fakeServices, mediaModule } from './helpers';
import { createTestDomainTools } from './test-domain';

/** A scripted model: says what it needs, then fills arguments for the schema it was given. */
interface ScriptedModel {
  readonly need: string;
  call(schemas: readonly ToolSchema[]): { callName: string; arguments: unknown } | undefined;
}

async function agentTurn(
  catalogue: ToolCatalogue,
  executor: ToolExecutor,
  model: ScriptedModel,
  runId: RunId,
) {
  const systemPromptTools = formatCatalogue(catalogue.catalogue());
  const hits = catalogue.search(model.need, { limit: 3 });
  const schemas = unwrap(catalogue.loadSchemas(hits.slice(0, 1).map((hit) => hit.name)));
  const call = model.call(schemas);
  const result = call ? await executor.execute(call.callName, call.arguments, { runId }) : undefined;
  return { systemPromptTools, hits, schemas, result };
}

const wordCounter: ScriptedModel = {
  need: 'count the words in this caption',
  call: (schemas) => {
    const schema = schemas[0];
    if (!schema || !('text' in ((schema.inputSchema.properties as object) ?? {}))) return undefined;
    return { callName: schema.callName, arguments: { text: 'hook in the first second' } };
  },
};

/** The composition root: the only place that lists modules. */
function compose(modules: Parameters<typeof createToolRegistry>[0]) {
  const registry = unwrap(createToolRegistry(modules));
  return { catalogue: registry as ToolCatalogue, executor: createToolExecutor({ registry }) };
}

describe('P1-G1: a tool added in a domain package reaches the agent with no agent change', () => {
  it('is absent before the domain module is composed in', async () => {
    const { catalogue, executor } = compose([mediaModule]);
    const turn = await agentTurn(catalogue, executor, wordCounter, newId());
    expect(turn.systemPromptTools).toBe(
      'media: media.probe: Reads the duration, streams and codecs of a video or audio file with ffprobe.',
    );
    expect(turn.hits.map((h) => h.name)).not.toContain('testdomain.countWords');
    expect(turn.result).toBeUndefined();
  });

  it('appears in the catalogue, ranks first in search, loads its schema and runs once composed in', async () => {
    const { catalogue, executor } = compose([mediaModule, createTestDomainTools(fakeServices())]);
    const turn = await agentTurn(catalogue, executor, wordCounter, newId());

    expect(turn.systemPromptTools).toContain(
      'testdomain: testdomain.countWords: Counts the words in a piece of text, such as a caption or a transcript line.',
    );
    expect(turn.hits[0]?.name).toBe('testdomain.countWords');
    expect(turn.schemas).toEqual([
      {
        name: 'testdomain.countWords',
        callName: 'testdomain_countWords',
        version: '1.0.0',
        description: 'Counts the words in a piece of text, such as a caption or a transcript line.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'The text to count' } },
          required: ['text'],
        },
        outputSchema: expect.objectContaining({ type: 'object' }),
      },
    ]);
    expect(turn.result?.ok && turn.result.value.value).toEqual({ words: 5 });
  });

  it('exposes every tool of the module with policy metadata and exportable schemas', () => {
    const { catalogue } = compose([mediaModule, createTestDomainTools(fakeServices())]);
    const names = catalogue.catalogue({ families: ['testdomain'] }).map((e) => e.name);
    expect(names).toEqual([
      'testdomain.captionFrame',
      'testdomain.countWords',
      'testdomain.deleteClip',
      'testdomain.listClips',
      'testdomain.renameClip',
      'testdomain.shareClip',
    ]);
    expect(catalogue.describe('testdomain.deleteClip')).toMatchObject({
      sideEffect: 'destructive',
      command: 'testdomain.deleteClip',
      requiresApproval: true,
    });
    expect(catalogue.describe('testdomain.captionFrame')).toMatchObject({
      costClass: 'cloud',
      estimatesCost: true,
    });
    for (const target of ['draft-07', 'openapi-3.0'] as const) {
      const schemas = unwrap(catalogue.loadSchemas(names, { target }));
      expect(schemas.every((s) => s.inputSchema.type === 'object')).toBe(true);
    }
  });

  it('keeps the fixture shaped like a domain package: it imports only @taalcut/core and zod', () => {
    const dir = join(import.meta.dirname, 'test-domain');
    const specifiers = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) =>
        [...readFileSync(join(dir, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]),
      );
    expect(new Set(specifiers)).toEqual(new Set(['@taalcut/core', 'zod']));
  });
});
