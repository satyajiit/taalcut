// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for the Editor's `graphics` tools (render SPEC P3.12, HFW1), built from core's contract only. A new
 * graphic, or a new look for one, is a `graphics.design` job for the Designer: the stand-in records the job as the
 * model wrote it (core's `graphicsDesignJobSchema`, model-facing). `graphics.edit` (a graphic's time, its length and
 * its words, its design's variables) and `graphics.remove` dispatch their commands, and the test checks every
 * dispatched payload against core's command payload schemas, as the command bus does. HFW1 retire: no kit fields.
 *
 * The model-facing input can't be core's payload schema as is: ids are `z.custom` and times carry a rate
 * transform, which JSON Schema can't express (the tool registry refuses them). So ids are ULID strings and a
 * time is core's `rationalTimeJsonSchema`, as render's real tools need too.
 */
import {
  defineTool,
  defineToolModule,
  GRAPHICS_COMMANDS,
  GRAPHICS_DESIGN_TOOL,
  graphicParamValuesSchema,
  graphicsDesignJobSchema,
  NO_TOOL_RETRY,
  ok,
  rationalTimeJsonSchema,
  ULID_PATTERN,
  type GraphicsDesignJob,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';

const ulid = z.string().regex(ULID_PATTERN);
const anchor = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phrase'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('Words someone says in the video, as the captions have them'),
    occurrence: z.int().min(1).max(20),
  }),
  z.object({ kind: z.literal('slot'), slotId: ulid }),
  z.object({ kind: z.literal('time'), at: rationalTimeJsonSchema }),
]);
const target = { projectId: ulid, timelineId: ulid };

function command<S extends z.ZodObject>(name: string, description: string, input: S) {
  return defineTool({
    name,
    version: '2.0.0',
    description,
    input,
    output: z.object({ done: z.boolean() }),
    costClass: 'local',
    sideEffect: 'write',
    command: name,
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (value) => JSON.stringify(value),
    run: async (value, ctx) => {
      const done = await ctx.dispatch(value);
      return done.ok ? ok({ done: true }) : done;
    },
  });
}

/** The tools; `jobs` gets every design job the model asks for, as it wrote it. */
export function graphicsModule(jobs: GraphicsDesignJob[] = []): ToolModule {
  const design = defineTool({
    name: GRAPHICS_DESIGN_TOOL,
    version: '2.0.0',
    description:
      'Asks the Designer for a new graphic or a new look for graphics already on the timeline: the person’s ' +
      'request word for word, and when a new one comes on (at, a phrase someone says, or a target).',
    summary: 'Asks the Designer for a new graphic or a new look for one, from the person’s words.',
    input: graphicsDesignJobSchema,
    output: z.object({ recorded: z.boolean() }),
    // As render's: it records a job for the Designer's step and changes nothing on the bus itself.
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async (value) => {
      jobs.push(value);
      return ok({ recorded: true });
    },
  });
  return defineToolModule({
    id: 'graphics',
    tools: [
      design,
      command(
        GRAPHICS_COMMANDS.edit,
        "Changes a graphic's time (its anchor), its length, or its words and colours (`params`, its design's " +
          'variables by name). A move, a resize or a new look is graphics.design.',
        z.object({
          ...target,
          itemId: ulid,
          anchor: anchor.optional(),
          duration: rationalTimeJsonSchema.optional(),
          params: graphicParamValuesSchema.optional(),
        }),
      ),
      command(GRAPHICS_COMMANDS.remove, 'Removes a graphic.', z.object({ ...target, itemId: ulid })),
    ],
  });
}
