// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A domain package the agent has never heard of, with a tool module and a
 * skill module, shaped like a real one: it imports only @taalcut/core and
 * zod. skills.test.ts shows the agent runs its skill with no change to
 * packages/agent (P2-T5 machinery).
 */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  newId,
  NO_TOOL_RETRY,
  ok,
  type SkillModule,
  type SkillVerdict,
  type ToolModule,
  ULID_PATTERN,
} from '@taalcut/core';
import { z } from 'zod';

export interface Things {
  readonly versions: Map<string, number>;
  /** What the second method says, check by check (past the end: pass). */
  verdicts: SkillVerdict[];
  checks: number;
}

export const createThings = (verdicts: SkillVerdict[] = []): Things => ({
  versions: new Map(),
  verdicts,
  checks: 0,
});

const ulid = z.string().regex(ULID_PATTERN);
const local = {
  costClass: 'local' as const,
  timeoutMs: 1_000,
  retry: NO_TOOL_RETRY,
  sideEffect: 'read' as const,
};

export function testdomainTools(things: Things): ToolModule {
  return defineToolModule({
    id: 'testdomain',
    tools: [
      defineTool({
        name: 'testdomain.makeThing',
        version: '1.0.0',
        description: 'Makes and stores a thing from a shape.',
        input: z.object({ shape: z.string() }),
        output: z.object({ thingId: ulid, version: z.int() }),
        ...local,
        run: async () => {
          const thingId = newId<'Thing'>();
          things.versions.set(thingId, 1);
          return ok({ thingId, version: 1 });
        },
      }),
    ],
  });
}

/** Another domain's tool, outside the skill's subset. */
export function otherTools(): ToolModule {
  return defineToolModule({
    id: 'other',
    tools: [
      defineTool({
        name: 'other.peek',
        version: '1.0.0',
        description: 'Peeks at something unrelated.',
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        ...local,
        run: async () => ok({ ok: true }),
      }),
    ],
  });
}

export function testdomainSkills(things: Things): SkillModule {
  const maker = defineSkill({
    id: 'testdomain.maker',
    version: '2.1.0',
    labelKey: 'skills.testdomain.maker',
    description: 'Makes a thing of the given shape and hands off its id.',
    prompt: 'Make the thing with testdomain.makeThing, then hand off its id and version.',
    tools: { families: ['testdomain'] },
    input: z.object({ shape: z.enum(['round', 'square']) }),
    output: z.object({ thingId: ulid, version: z.int().min(1) }),
    refs: (out) => [{ entity: 'template', id: out.thingId, version: out.version }],
    async verify() {
      const verdict = things.verdicts[things.checks] ?? { verdict: 'pass' };
      things.checks += 1;
      return ok(verdict);
    },
    card: async (out, ctx) =>
      ok({
        type: 'progress',
        id: 'own-id',
        version: 1,
        labelKey: `testdomain.made.${out.thingId}.v${out.version}`,
        state: 'succeeded',
        progress: null,
        ...(ctx.flowId ? {} : {}),
      }),
  });
  return defineSkillModule({ id: 'testdomain', skills: [maker] });
}
