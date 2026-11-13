// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineTool,
  defineToolModule,
  err,
  ulidSchema,
  NO_TOOL_RETRY,
  ok,
  ValidationError,
  type AsyncResult,
  type BackgroundPlacement,
  type Card,
  type CommandToolContext,
  type ShortsRun,
  type ShortsRunId,
  type ToolCardContext,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { evidenceKey } from './evidence';
import type { ShortsService } from './service';
import { shortsRequestToolSchema, shortsRunToolSchema } from './tool-schemas';

export interface ShortsToolDependencies {
  /** Bind compose to this tool's timeline.create dispatch; all other reads and model calls remain ports. */
  readonly service: (context: CommandToolContext) => ShortsService;
  readonly get: (runId: ShortsRunId) => ReturnType<ShortsService['get']>;
  /** Rebuild the registered module with the model/privacy profile, as the other model tools do. */
  readonly placement?: BackgroundPlacement;
  readonly resultCard?: (run: ShortsRun, context: ToolCardContext) => AsyncResult<Card | undefined>;
}

export function shortsToolModule(deps: ShortsToolDependencies): ToolModule {
  const cloud = deps.placement !== 'local';
  const metadata = {
    version: '1.0.0',
    command: 'timeline.create',
    costClass: cloud ? ('cloud' as const) : ('local' as const),
    sideEffect: 'write' as const,
    timeoutMs: 2 * 60 * 60_000,
    retry: NO_TOOL_RETRY,
    permission: {
      filesystem: { read: ['library' as const], write: ['library' as const] },
      network: cloud ? ('internet' as const) : ('lan' as const),
      ...(cloud
        ? {
            cloudModules: ['agent', 'vision'],
            uploads: { what: 'user-media' as const, consent: 'first-use' as const },
          }
        : {}),
    },
    estimateCost: () => ({
      usd: 1,
      basis:
        'Whole-source selection and independent verification; actual cost depends on source length and model.',
    }),
  };
  const generate = defineTool({
    ...metadata,
    name: 'shorts.generate',
    summary: 'Creates a faithful portrait short, editable timeline and finished exports after QA.',
    description:
      'Read the whole indexed source, identify a complete hook/context/payoff, independently verify ' +
      'meaning and source B-roll, then create an editable portrait timeline and wait for finished platform exports and QA. Duration is a maximum including ' +
      'the ending overlay; default 60 seconds. Pass a library asset id, never a reference template. A run can ' +
      'need review or find no faithful candidate. Reuse runId to resume. Never publish automatically. ' +
      'Only when the creator explicitly requests publishing, use Postiz uploadFile with the finished renderId, ' +
      'adjust:false and the cover asset. Do not invoke Postiz clipping or generate another short from the finished export.',
    tags: ['shorts', 'reels', 'video', 'hook', 'story', 'portrait'],
    input: shortsRequestToolSchema.extend({ runId: ulidSchema('ShortsRun').optional() }),
    output: shortsRunToolSchema,
    idempotencyKey: (input) => evidenceKey('generate', input),
    ...(deps.resultCard ? { resultCard: deps.resultCard } : {}),
    run: async ({ runId, ...request }, ctx) =>
      deps.service(ctx).generate(request, { runId, signal: ctx.signal }),
  });
  const reference = z.object({ projectId: ulidSchema('Project'), runId: ulidSchema('ShortsRun') });
  const regenerate = defineTool({
    ...metadata,
    name: 'shorts.regenerate',
    summary: 'Makes a new short draft from a previous request, preserving the previous draft.',
    description:
      'Regenerate a short from its source request. Reuses source evidence and recorded model ' +
      'analysis when unchanged, but creates a separate editable draft. Use only when the creator asks for another draft.',
    input: reference,
    output: shortsRunToolSchema,
    idempotencyKey: (input) => evidenceKey('regenerate', input),
    ...(deps.resultCard ? { resultCard: deps.resultCard } : {}),
    run: async (input, ctx) => {
      const found = await deps.get(input.runId);
      if (!found.ok) return found;
      if (found.value?.request.projectId !== input.projectId)
        return err(ValidationError({ field: 'projectId' }));
      return deps.service(ctx).regenerate(input.runId, { signal: ctx.signal });
    },
  });
  const get = defineTool({
    name: 'shorts.get',
    version: '1.0.0',
    summary: 'Reads the saved short draft and its evidence, status and review issues.',
    description:
      'Read a durable short run, including original source ranges, editorial status and editable timeline id.',
    input: reference,
    output: shortsRunToolSchema.nullable(),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] }, network: 'none' },
    run: async (input) => {
      const found = await deps.get(input.runId);
      if (!found.ok) return found;
      return ok(found.value?.request.projectId === input.projectId ? found.value : null);
    },
  });
  return defineToolModule({ id: 'shorts', tools: [generate, regenerate, get] });
}
