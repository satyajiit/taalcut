// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `soul.setDials` 1.0.0 (SPEC section 22): the agent's way to move the dials when the user asks for a lasting
 * change ("be more professional from now on"). A thin wrapper over `agent.setSoulDials`, so the change is the
 * same undoable, audited step as Settings → Agent. Stops are named as SOUL.md names them.
 */
import {
  AGENT_SETTING_COMMANDS,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  soulDialsSchema,
  type ToolModule,
} from '@taalcut/core';
import { contentHash } from '@taalcut/tools';
import { z } from 'zod';
import type { SoulStops } from './soul-file';

export const SOUL_TOOL = 'soul.setDials';

const stopOutput = z.object({ stop: z.string(), name: z.string() });

export function soulToolModule(input: { readonly stops: SoulStops }): ToolModule {
  const { stops } = input;
  const toneIds = stops.tone.map((s) => s.id);
  const verbosityIds = stops.verbosity.map((s) => s.id);
  const describe = (dial: keyof SoulStops) =>
    stops[dial].map((s) => `${s.id} (${s.name}): ${s.says}`).join(' ');
  const setDials = defineTool({
    name: SOUL_TOOL,
    version: '1.0.0',
    description:
      'Changes how you talk from the next run on: tone (playful to professional) and verbosity (just do it to ' +
      'teach me). Call it only when the user asks for a lasting change ("be more professional from now on", ' +
      '"keep it shorter from now on"), never to adjust one reply. Give only the dial they asked about. Undoable.',
    summary:
      'Changes the tone or verbosity dial from the next run on, when the user asks for a lasting change.',
    tags: ['tone', 'verbosity', 'persona', 'dials', 'professional', 'playful', 'shorter', 'explain'],
    input: z
      .object({
        tone: z.enum(toneIds).optional().describe(describe('tone')),
        verbosity: z.enum(verbosityIds).optional().describe(describe('verbosity')),
      })
      .refine((v) => v.tone !== undefined || v.verbosity !== undefined, { message: 'Give a dial to change' }),
    output: z.object({
      tone: stopOutput,
      verbosity: stopOutput,
      appliesFrom: z.literal('nextRun'),
    }),
    costClass: 'local',
    sideEffect: 'write',
    command: AGENT_SETTING_COMMANDS.setSoulDials,
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    // MCP clients can't change the persona (the command refuses them): don't offer it there.
    exposure: { mcp: false },
    idempotencyKey: (call) => contentHash([SOUL_TOOL, call]),
    run: async (call, ctx) => {
      const done = await ctx.dispatch({
        ...(call.tone !== undefined ? { tone: toneIds.indexOf(call.tone) } : {}),
        ...(call.verbosity !== undefined ? { verbosity: verbosityIds.indexOf(call.verbosity) } : {}),
      });
      if (!done.ok) return done;
      const dials = soulDialsSchema.parse(done.value);
      const at = (dial: keyof SoulStops, index: number) => {
        const stop = stops[dial][index];
        return { stop: stop?.id ?? String(index), name: stop?.name ?? String(index) };
      };
      return ok({
        tone: at('tone', dials.tone),
        verbosity: at('verbosity', dials.verbosity),
        appliesFrom: 'nextRun' as const,
      });
    },
  });
  return defineToolModule({ id: 'soul', tools: [setDials] });
}
