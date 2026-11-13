// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V5's agent tool: a pro export (OTIO or FCPXML) of one timeline at a known revision. */
import {
  defineTool,
  INTERCHANGE_FORMATS,
  INTERCHANGE_PATH_STYLES,
  NO_TOOL_RETRY,
  ok,
  TIMELINE_COMMANDS,
  ulidSchema,
  type AnyTool,
} from '@taalcut/core';
import { z } from 'zod';
import { toolKey } from './hash';

const itemId = ulidSchema('TimelineItem');

export const interchangeToolInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  format: z
    .enum(INTERCHANGE_FORMATS)
    .describe("'otio' for DaVinci Resolve and Premiere Pro; 'fcpxml' for Final Cut Pro"),
  revision: z
    .int()
    .positive()
    .describe('The revision you read with timeline.get; another current revision is refused'),
  pathStyle: z.enum(INTERCHANGE_PATH_STYLES).default('fileUrl'),
});

export const interchangeToolOutputSchema = z.object({
  fileName: z.string().min(1).max(255),
  warnings: z
    .array(
      z.discriminatedUnion('code', [
        z.object({ code: z.literal('mediaOffline'), clipId: itemId }),
        z.object({ code: z.literal('rampApproximated'), clipId: itemId }),
        z.object({ code: z.literal('transitionAsCut'), itemId }),
        z.object({ code: z.literal('textAsMarker'), count: z.int().positive() }),
        z.object({ code: z.literal('imageAsStill'), clipId: itemId }),
      ]),
    )
    .max(500),
});

export function interchangeTools(): AnyTool[] {
  const exportTool = defineTool({
    name: TIMELINE_COMMANDS.exportInterchange,
    version: '1.0.0',
    description:
      "Writes the timeline as a file another editor opens: OpenTimelineIO (.otio) for DaVinci Resolve and Premiere Pro, or FCPXML 1.14 for Final Cut Pro, with the originals linked by path and every cut on the same frame. The file goes to Taalcut's exports folder; the person saves a copy with Save as. Changes nothing in the project. The warnings say what the other editor won't get exactly: offline originals, speed ramps, transitions written as plain cuts with a marker, text as markers, stills.",
    summary: 'Writes an .otio (Resolve, Premiere) or FCPXML (Final Cut) file of the timeline.',
    tags: ['export', 'otio', 'fcpxml', 'resolve', 'premiere', 'final-cut'],
    input: interchangeToolInputSchema,
    output: interchangeToolOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    // An export, like render.export: the default autonomy stops before it, and over MCP it needs the export
    // level and an in-app approval (plan, MCP server: "destructive and export actions still wait"). It changes
    // nothing in the project, so it stays a write with no inverse.
    checkpoint: true,
    command: TIMELINE_COMMANDS.exportInterchange,
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey(TIMELINE_COMMANDS.exportInterchange, input),
    run: async (input, ctx) => {
      const done = await ctx.dispatch(input);
      return done.ok ? ok(interchangeToolOutputSchema.parse(done.value)) : done;
    },
  });
  return [exportTool as AnyTool];
}
