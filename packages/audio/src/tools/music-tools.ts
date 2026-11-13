// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music tools audio owns (SPEC P3.9): `music.generate` (path c: a track composed to the timeline's tempo and
 * length, warped onto its beat map, then chosen with `music.choosePath`) and `music.setDucking` (the voice-over-
 * music margin). The bundled pack's `music.findLibraryTrack` and `music.useLibraryTrack` join through `library`.
 * The `music` module id is shared with render's `music.choosePath` tool; the agent root offers them as one module.
 */
import {
  defineTool,
  defineToolModule,
  MIX_COMMANDS,
  MUSIC_COMMANDS,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type AnyTool,
  type TimelineStore,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { readTimeline } from '../commands/timeline-writes';
import type { createMusicGenerator } from '../music/generate-track';
import { ESTIMATE_BOUNDS, musicEstimate, type GenerationPrices } from './prices';
import { refineMusicCost } from './refine-costs';
import { inputKey } from './tool-keys';

export interface MusicToolDeps {
  readonly generator: Pick<ReturnType<typeof createMusicGenerator>, 'generate'>;
  readonly timelines: TimelineStore;
  readonly prices: GenerationPrices;
}

const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') };

const generateOutput = z.object({
  assetId: z.string(),
  path: z
    .enum(['generated', 'ownTrack'])
    .describe('generated: warped onto the beat map; ownTrack: no beat map'),
  bpm: z.number().positive(),
  grid: z
    .object({ maxErrorMs: z.number(), p95ErrorMs: z.number(), missed: z.number().min(0).max(1) })
    .nullable()
    .describe('How close the warped beats sit to the timeline grid (pass: within one frame)'),
  warped: z.boolean(),
  attempts: z.int().min(1).max(2),
  costUsd: z.number().nonnegative(),
});

function generateTool(deps: MusicToolDeps) {
  return defineTool({
    name: 'music.generate',
    version: '1.0.0',
    description:
      "Composes an instrumental music track to the timeline's tempo and length (mood words and an optional " +
      'prompt; never name artists or songs), warps it onto the beat map within one frame and chooses it as the ' +
      "timeline's music. Off-grid twice is music_off_grid with a fix. Paid. Undoable.",
    summary: "Composes music to the timeline's tempo and length and puts it on the beat map.",
    tags: ['music', 'generate', 'beat', 'tempo'],
    input: z.object({
      ...target,
      mood: z.array(z.string().min(1).max(30)).max(6).optional().describe('Mood words, e.g. warm, driving'),
      prompt: z.string().min(1).max(400).optional(),
      vocals: z.literal(false).optional().describe('Instrumental only; vocals only when the user asks'),
    }),
    output: generateOutput,
    costClass: 'paid',
    sideEffect: 'write',
    command: MUSIC_COMMANDS.choosePath,
    timeoutMs: 300_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', cloudModules: ['music'] },
    idempotencyKey: (input) => inputKey('music.generate', input),
    estimateCost: () =>
      musicEstimate(
        deps.prices,
        ESTIMATE_BOUNDS.musicSeconds,
        `at most ${ESTIMATE_BOUNDS.musicSeconds} s of music at the estimated price (no fixed rate is published)`,
      ),
    refineCost: (input, ctx) => refineMusicCost(deps, input, ctx),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const made = await deps.generator.generate({
        timeline: timeline.value,
        ...(input.mood ? { mood: input.mood } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        vocals: false,
        signal: ctx.signal,
        trace: { ...(ctx.runId ? { runId: ctx.runId } : {}), projectId: timeline.value.projectId },
      });
      if (!made.ok) return made;
      if (made.value.costUsd > 0) ctx.reportUsage({ usd: made.value.costUsd });
      const done = await ctx.dispatch({
        projectId: input.projectId,
        timelineId: input.timelineId,
        choice: made.value.choice,
      });
      if (!done.ok) return done;
      return ok({
        assetId: made.value.assetId,
        path: made.value.choice.path === 'generated' ? ('generated' as const) : ('ownTrack' as const),
        bpm: made.value.bpm,
        grid: made.value.grid
          ? {
              maxErrorMs: made.value.grid.maxErrorMs,
              p95ErrorMs: made.value.grid.p95ErrorMs,
              missed: made.value.grid.missed,
            }
          : null,
        warped: made.value.warped,
        attempts: made.value.attempts,
        costUsd: made.value.costUsd,
      });
    },
  });
}

const duckingOutput = z.object({ enabled: z.boolean(), marginLu: z.number() });

function setDuckingTool(deps: Pick<MusicToolDeps, 'timelines'>) {
  return defineTool({
    name: 'music.setDucking',
    version: '1.0.0',
    description:
      'Turns music ducking under voice on or off, or sets how far the voice stays above the music in LU of ' +
      'short-term loudness (6–20; 8 by default). Render applies it at mix time. Undoable.',
    summary: 'Sets music ducking under the voice: on or off, and the margin in LU.',
    tags: ['music', 'ducking', 'mix', 'loudness'],
    input: z
      .object({ ...target, enabled: z.boolean().optional(), marginLu: z.number().min(6).max(20).optional() })
      .refine((input) => input.enabled !== undefined || input.marginLu !== undefined, {
        message: 'Give enabled, marginLu or both',
      }),
    output: duckingOutput,
    costClass: 'local',
    sideEffect: 'write',
    command: MIX_COMMANDS.setDucking,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (input) => inputKey('music.setDucking', input),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const patch = {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.marginLu !== undefined ? { marginLu: input.marginLu } : {}),
      };
      const done = await ctx.dispatch({
        projectId: input.projectId,
        timelineId: input.timelineId,
        ducking: patch,
      });
      if (!done.ok) return done;
      const ducking = { ...timeline.value.mix.ducking, ...patch };
      return ok({ enabled: ducking.enabled, marginLu: ducking.marginLu });
    },
  });
}

/** Audio's `music` tools; `library` adds the bundled pack's when the pack's catalogue is wired. */
export function musicGenerationTools(deps: MusicToolDeps): AnyTool[] {
  return [generateTool(deps), setDuckingTool(deps)];
}

export function musicGenerationToolModule(deps: MusicToolDeps, library: readonly AnyTool[] = []): ToolModule {
  return defineToolModule({ id: 'music', tools: [...musicGenerationTools(deps), ...library] });
}
