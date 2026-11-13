// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { newId } from '../basics/ids';
import { ok } from '../basics/result';
import { artifactRefSchema } from './artifacts';
import { NO_TOOL_RETRY, toolNeedsApproval, type AnyTool, type ToolSpec } from './contract';
import {
  defineTool,
  defineToolModule,
  toolFamily,
  toolModuleProblems,
  toolSpecProblems,
  toolSummary,
} from './define';

const readTool = defineTool({
  name: 'demo.countWords',
  version: '1.0.0',
  description: 'Counts the words in a piece of text. Returns the count.',
  input: z.object({ text: z.string() }),
  output: z.object({ words: z.number().int() }),
  costClass: 'local',
  sideEffect: 'read',
  timeoutMs: 1000,
  retry: NO_TOOL_RETRY,
  cache: true,
  run: async (input) => ok({ words: input.text.split(/\s+/).filter(Boolean).length }),
});

const commandTool = defineTool({
  name: 'demo.rename',
  version: '2.1.0',
  description: 'Renames the demo thing.',
  input: z.object({ id: z.string(), title: z.string() }),
  output: z.object({ renamed: z.boolean() }),
  costClass: 'local',
  sideEffect: 'write',
  timeoutMs: 1000,
  retry: { maxAttempts: 3, initialDelayMs: 10 },
  command: 'demo.rename',
  idempotencyKey: (input) => `${input.id}:${input.title}`,
  run: async (input, ctx) => {
    const dispatched = await ctx.dispatch({ id: input.id, title: input.title });
    return dispatched.ok ? ok({ renamed: true }) : dispatched;
  },
});

const cloudTool = defineTool({
  name: 'demo.describe',
  version: '0.1.0',
  description: 'Describes an image with a cloud model.',
  input: z.object({ image: z.string() }),
  output: z.string(),
  costClass: 'cloud',
  sideEffect: 'read',
  timeoutMs: 60_000,
  retry: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000, factor: 2 },
  permission: { network: 'internet', cloudModules: ['vision'], filesystem: { read: ['library'] } },
  estimateCost: () => ({ usd: 0.002, tokens: 1200 }),
  run: async () => ok('a beach at sunset'),
});

function variant(overrides: Partial<AnyTool>): AnyTool {
  return { ...(readTool as AnyTool), ...overrides };
}

describe('defineTool', () => {
  it('returns the spec unchanged and infers types', () => {
    expect(defineTool(readTool)).toBe(readTool);
    expectTypeOf(readTool.command).toEqualTypeOf<undefined>();
    expectTypeOf(commandTool.command).toEqualTypeOf<'demo.rename' | undefined>();
    type ReadRun = Parameters<typeof readTool.run>;
    expectTypeOf<ReadRun[0]>().toEqualTypeOf<{ text: string }>();
    expectTypeOf<ReadRun[1]>().not.toHaveProperty('dispatch');
    expectTypeOf<Parameters<typeof commandTool.run>[1]>().toHaveProperty('dispatch');
  });

  it('keeps specific tools assignable to AnyTool so modules hold plain arrays', () => {
    const module = defineToolModule({ id: 'demo', tools: [readTool, commandTool, cloudTool] });
    expectTypeOf(module.tools[0]).toEqualTypeOf<ToolSpec | undefined>();
    expect(toolModuleProblems(module)).toEqual([]);
  });
});

describe('summary, family and approval', () => {
  it('derives the summary from the first sentence', () => {
    expect(toolSummary(readTool)).toBe('Counts the words in a piece of text.');
    expect(toolSummary({ description: 'No full stop here' })).toBe('No full stop here');
    expect(toolSummary({ description: 'Ignored.', summary: 'Explicit' })).toBe('Explicit');
    expect(toolSummary({ description: 'Reads v1.2 files.  Then more.' })).toBe('Reads v1.2 files.');
  });

  it('derives the family from the name prefix', () => {
    expect(toolFamily(readTool)).toBe('demo');
    expect(toolFamily({ name: 'demo.x', family: 'search' })).toBe('search');
  });

  it('requires approval for destructive and external tools only', () => {
    expect(toolNeedsApproval({ sideEffect: 'read' })).toBe(false);
    expect(toolNeedsApproval({ sideEffect: 'write' })).toBe(false);
    expect(toolNeedsApproval({ sideEffect: 'destructive' })).toBe(true);
    expect(toolNeedsApproval({ sideEffect: 'external' })).toBe(true);
  });

  it('asks for an alwaysAsk write at every level and refuses alwaysAsk on a read', () => {
    expect(toolNeedsApproval({ sideEffect: 'write', alwaysAsk: true })).toBe(true);
    expect(toolNeedsApproval({ sideEffect: 'write' })).toBe(false);
    expect(toolSpecProblems({ ...commandTool, alwaysAsk: true })).toEqual([]);
    expect(toolSpecProblems({ ...readTool, alwaysAsk: true })).toEqual([
      "demo.countWords: alwaysAsk is for tools that change state, not 'read' ones",
    ]);
  });

  it('accepts savesProgress on a tool, and refuses it on a cached one (LRN1-CTX)', () => {
    expect(toolSpecProblems({ ...readTool, cache: undefined, savesProgress: true })).toEqual([]);
    expect(toolSpecProblems({ ...commandTool, savesProgress: true })).toEqual([]);
    expect(toolSpecProblems({ ...readTool, savesProgress: true })).toEqual([
      "demo.countWords: a tool that saves progress can't be cached",
    ]);
  });
});

describe('toolSpecProblems', () => {
  it('accepts well-formed tools', () => {
    expect(toolSpecProblems(readTool)).toEqual([]);
    expect(toolSpecProblems(commandTool as AnyTool)).toEqual([]);
    expect(toolSpecProblems(cloudTool)).toEqual([]);
  });

  it.each<[string, Partial<AnyTool>, RegExp]>([
    ['bad name', { name: 'Demo.count' }, /family\.camelCase/],
    ['long name', { name: `demo.${'a'.repeat(70)}` }, /64 characters/],
    ['bad version', { version: '1.0' }, /not semver/],
    ['empty description', { description: '  ' }, /description is empty/],
    ['long summary', { summary: 'x'.repeat(121) }, /one line/],
    ['bad family', { family: 'Search' }, /family must be/],
    ['bad tag', { tags: ['Has Space'] }, /tag 'Has Space'/],
    ['bad cost class', { costClass: 'free' as never }, /unknown cost class/],
    ['bad side effect', { sideEffect: 'nuke' as never }, /unknown side-effect/],
    ['bad timeout', { timeoutMs: 0 }, /timeoutMs/],
    ['missing retry', { retry: undefined as never }, /retry policy is missing/],
    ['too many attempts', { retry: { maxAttempts: 11, initialDelayMs: 0 } }, /maxAttempts/],
    ['negative delay', { retry: { maxAttempts: 2, initialDelayMs: -1 } }, /initialDelayMs/],
    ['max below initial', { retry: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 5 } }, /maxDelayMs/],
    ['factor below one', { retry: { maxAttempts: 2, initialDelayMs: 10, factor: 0.5 } }, /factor/],
    ['bad fs scope', { permission: { filesystem: { write: ['root' as never] } } }, /filesystem scope 'root'/],
    ['cloud module offline', { permission: { cloudModules: ['vision'] } }, /cloudModules need/],
    ['read with command', { command: 'demo.rename' }, /can't be 'read'/],
    ['bad command name', { sideEffect: 'write', command: 'Rename', cache: false }, /not a command name/],
    ['write without command', { sideEffect: 'write', cache: false }, /must wrap a command/],
    ['write without key', { sideEffect: 'external', cache: false }, /idempotencyKey/],
    [
      'cached write',
      { sideEffect: 'external', idempotencyKey: () => 'k' },
      /only 'read' tools can be cached/,
    ],
    ['cloud without estimate', { costClass: 'paid', permission: { network: 'internet' } }, /estimateCost/],
    ['cloud offline', { costClass: 'cloud', estimateCost: () => ({ usd: 0 }) }, /network 'internet'/],
    ['refined without a bound', { refineCost: async () => ok({ usd: 0 }) }, /refineCost/],
    ['run missing', { run: undefined as never }, /run is not a function/],
  ])('flags %s', (_label, overrides, pattern) => {
    const problems = toolSpecProblems(variant(overrides));
    expect(
      problems.some((p) => pattern.test(p)),
      problems.join('\n'),
    ).toBe(true);
  });

  it('labels problems on unnamed tools', () => {
    expect(toolSpecProblems(variant({ name: '' }))[0]).toMatch(/^<unnamed>:/);
  });

  it('allows an approval card only on tools that ask', () => {
    const card = () =>
      Promise.resolve(ok({ type: 'error' as const, id: 'x', version: 1 as const, error: {} as never }));
    const pattern = /approvalCard is only for tools that ask/;
    expect(toolSpecProblems({ ...readTool, approvalCard: card }).some((p) => pattern.test(p))).toBe(true);
    const external = variant({
      sideEffect: 'external',
      idempotencyKey: () => 'k',
      cache: false,
      approvalCard: card,
    });
    expect(toolSpecProblems(external)).toEqual([]);
    const checkpoint = { ...readTool, checkpoint: true, approvalCard: card };
    expect(toolSpecProblems(checkpoint).some((p) => pattern.test(p))).toBe(false);
    expect(toolSpecProblems({ ...readTool, resultCard: () => Promise.resolve(ok(undefined)) })).toEqual([]);
  });
});

describe('toolModuleProblems', () => {
  it('checks the id, emptiness and name prefixes', () => {
    expect(toolModuleProblems({ id: 'Bad-Id', tools: [] })).toEqual([
      "module 'Bad-Id': id must be lowercase letters and digits",
      "module 'Bad-Id': has no tools",
    ]);
    expect(toolModuleProblems({ id: 'other', tools: [readTool] })).toEqual([
      "demo.countWords: name must start with 'other.'",
    ]);
  });
});

describe('artifactRefSchema', () => {
  it('accepts refs with a ULID and rejects others', () => {
    const ref = { id: newId<'Artifact'>(), mediaType: 'application/json', bytes: 10, summary: 's' };
    expect(artifactRefSchema.parse(ref)).toEqual(ref);
    expect(artifactRefSchema.safeParse({ ...ref, id: 'nope' }).success).toBe(false);
  });
});
