// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `music.choosePath` for the agent (SPEC section 11): wraps the timeline
 * lane's command of the same name. The agent can pick (a) platform sound,
 * (b) the user's own track or (d) the reel's own music, which the template
 * keeps on this Mac (REF1: no acknowledgement). The input has no
 * `acknowledgedAt`.
 *
 * TODO(timeline): if the timeline lane registers its own music tool module, drop this one.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  defineTool,
  defineToolModule,
  MUSIC_COMMANDS,
  MUSIC_PATHS,
  NO_TOOL_RETRY,
  ok,
  type ToolModule,
  ulidSchema,
} from '@taalcut/core';
import { rateSchema } from './schemas';

const gainDb = z.number().min(-60).max(12);

export const musicChoiceToolSchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('none') }).describe('Keep source sound without adding a music bed'),
  z.object({ path: z.literal('platformSound') }).describe('No music in the file; added in the platform app'),
  z
    .object({
      path: z.literal('ownTrack'),
      assetId: ulidSchema('Asset'),
      offset: z.object({ value: z.int(), rate: rateSchema }).describe('Track time under the first frame'),
      gainDb,
    })
    .describe("The user's own or licensed track"),
  z
    .object({ path: z.literal('referenceAudio'), templateId: ulidSchema('Template'), gainDb })
    .describe("The reel's own music, which the template keeps; templateId is the timeline's template"),
]);

export function musicToolModule(): ToolModule {
  const choosePath = defineTool({
    name: MUSIC_COMMANDS.choosePath,
    version: '1.1.0',
    description:
      "Chooses the timeline's music: referenceAudio (the reel's own music, kept with the template; the default " +
      'when it has some), none (source sound only), platformSound (no music in the file; the user adds the sound in the app) or ownTrack ' +
      "(the user's own or licensed track). Undoable.",
    summary: "Chooses the timeline's music: the reel's own music, platform sound or an own track.",
    tags: ['music', 'sound', 'audio', 'rights'],
    input: z.object({
      projectId: ulidSchema('Project'),
      timelineId: ulidSchema('Timeline'),
      choice: musicChoiceToolSchema,
    }),
    output: z.object({ path: z.enum(MUSIC_PATHS) }),
    costClass: 'local',
    sideEffect: 'write',
    command: MUSIC_COMMANDS.choosePath,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) =>
      createHash('sha256')
        .update(JSON.stringify(['music.choosePath', input]))
        .digest('hex'),
    run: async (input, ctx) => {
      const done = await ctx.dispatch(input);
      return done.ok ? ok({ path: input.choice.path }) : done;
    },
  });
  return defineToolModule({ id: 'music', tools: [choosePath] });
}
