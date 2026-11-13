// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A write tool for one timeline command: it dispatches the command as the agent (one undo step, re-sync included)
 * and answers what the edit changed. Its input is the command's payload unless `payload` builds one (applying a
 * kept plan). The command, not the tool, refuses agent edits on locked clips.
 */
import {
  defineTool,
  ConflictError,
  err,
  NO_TOOL_RETRY,
  ok,
  type AnyTool,
  type ArtifactStore,
  type AsyncResult,
  type ToolContextBase,
  type TimelineId,
} from '@taalcut/core';
import type { z } from 'zod';
import { toolKey } from './hash';
import { editToolOutputSchema } from './schemas';
import type { TimelineService } from '../service/service';

export interface EditCommandToolSpec<I extends z.ZodType> {
  /** The command it dispatches, also the tool's name. */
  readonly command: string;
  readonly service?: Pick<TimelineService, 'read'> | undefined;
  readonly description: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly input: I;
  /**
   * The command's payload from the tool's input; the input itself when absent. EDT1-OPS: `ctx` is the call's, for a
   * payload that checks the change against what a docked run pointed at (`ctx.editor`).
   */
  payload?(input: z.output<I>, artifacts: ArtifactStore, ctx: ToolContextBase): AsyncResult<unknown>;
  /** EDT1-OPS: what it answers; default `{ timelineId, revision }`. */
  readonly output?: z.ZodType;
  verify?(result: unknown): AsyncResult<void>;
  /** EDT1-OPS: an older caller's input mended before it is checked (core `ToolSpec.mendInput`). */
  readonly mendInput?: (input: unknown) => unknown;
}

export function editCommandTool<I extends z.ZodType>(spec: EditCommandToolSpec<I>): AnyTool {
  const output = spec.output ?? editToolOutputSchema;
  const tool = defineTool({
    name: spec.command,
    version: '1.0.0',
    description: spec.description,
    summary: spec.summary,
    tags: [...spec.tags],
    input: spec.input,
    output,
    costClass: 'local',
    sideEffect: 'write',
    command: spec.command,
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    ...(spec.mendInput ? { mendInput: spec.mendInput } : {}),
    idempotencyKey: (input) => toolKey(spec.command, input),
    run: async (input, ctx) => {
      // Capture admission before resolving positions, without replacing the run's
      // last-read numbering context when the model omitted an explicit revision.
      let revision: number | undefined;
      if (spec.service && input && typeof input === 'object' && 'timelineId' in input) {
        const target = input as { timelineId: TimelineId; revision?: number };
        revision = target.revision;
        if (revision === undefined) {
          const current = await spec.service.read(target.timelineId);
          if (!current.ok) return current;
          revision = current.value.revision;
        }
      }
      const payload = spec.payload ? await spec.payload(input, ctx.artifacts, ctx) : ok(input);
      if (!payload.ok) return payload;
      const value = payload.value;
      const admitted =
        revision !== undefined && value && typeof value === 'object' ? { ...value, revision } : value;
      const done = await ctx.dispatch(admitted);
      if (!done.ok) return done;
      if (spec.service) {
        const receipt = editToolOutputSchema.safeParse(done.value);
        if (receipt.success) {
          const current = await spec.service.read(receipt.data.timelineId);
          if (!current.ok) return current;
          if (current.value.revision !== receipt.data.revision)
            return err(ConflictError({ entity: 'timeline', id: receipt.data.timelineId }));
        }
      }
      if (spec.verify) {
        const verified = await spec.verify(done.value);
        if (!verified.ok) return verified;
      }
      return ok(output.parse(done.value));
    },
  });
  return tool as AnyTool;
}
