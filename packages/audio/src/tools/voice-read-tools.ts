// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice read tools (SPEC P3.9): `voice.fitScript` checks script lines against their slots before anything is
 * paid for (local, pure over the stored timeline), and `voice.listVoices` lists the provider's voices (free at the
 * provider; names are provider text, so untrusted). The voice module's tools: with voice-tools.ts' write tools,
 * `voiceToolModule` offers them as one module.
 */
import { defineTool, defineToolModule, ok, ulidSchema, type ToolModule } from '@taalcut/core';
import { z } from 'zod';
import { readTimeline } from '../commands/timeline-writes';
import { frameMs } from '../timeline/span';
import { VOICE_CONFIG } from '../voice/config';
import { fitScript } from '../voice/script-fit';
import { timelineSlots } from '../voice/slots';
import { voiceWriteTools, type VoiceToolDeps } from './voice-tools';

const HOUR_MS = 3_600_000;
const LOCAL_RETRY = { maxAttempts: 2, initialDelayMs: 500 };

const fitInput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  lines: z
    .array(
      z.object({
        text: z.string().min(1).max(VOICE_CONFIG.maxLineChars),
        slotId: ulidSchema('TemplateSlot').optional(),
      }),
    )
    .min(1)
    .max(VOICE_CONFIG.maxLines),
  language: z.string().min(2).max(35),
});

const fitOutput = z.object({
  lines: z.array(
    z.object({
      slotId: z.string().nullable(),
      estimatedMs: z.int().nonnegative(),
      slotMs: z.int().nonnegative(),
      overByMs: z.int().nonnegative().describe('0 when the line fits; else shorten it'),
      suggestedWords: z.int().positive().optional(),
    }),
  ),
});

const voicesOutput = z.object({
  voices: z
    .array(
      z.object({
        voiceId: z.string(),
        name: z.string().meta({ untrusted: 'provider' }),
        labels: z.record(z.string(), z.string().meta({ untrusted: 'provider' })),
        own: z.boolean().describe("A clone of the user's own voice, made from their consent recording"),
      }),
    )
    .max(200),
});

function fitScriptTool(deps: Pick<VoiceToolDeps, 'timelines'>) {
  return defineTool({
    name: 'voice.fitScript',
    version: '1.0.0',
    description:
      "Estimates how long each script line takes to say at the language's speaking rate and compares it with " +
      'its slot (plus half of an unvoiced next slot). A line over by more than 15 % comes back with overByMs and ' +
      'a suggested word count: shorten it before voice.generate. Free.',
    summary: 'Checks script lines against their slots before generating a voiceover.',
    tags: ['voiceover', 'script', 'timing'],
    input: fitInput,
    output: fitOutput,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: LOCAL_RETRY,
    cache: { ttlMs: HOUR_MS },
    permission: { network: 'none' },
    run: async (input) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const fits = fitScript({
        lines: input.lines,
        language: input.language,
        slots: timelineSlots(timeline.value),
        frameMs: frameMs(timeline.value),
      });
      return ok({ lines: fits });
    },
  });
}

function listVoicesTool(deps: Pick<VoiceToolDeps, 'provider' | 'consents'>) {
  return defineTool({
    name: 'voice.listVoices',
    version: '1.0.0',
    description:
      "Lists the voice provider's voices, optionally for a language, with their labels (accent, gender, age, " +
      "use) and whether one is the user's own clone. Never pick a voice because its name matches a real person.",
    summary: "Lists the voice provider's voices and the user's own clone.",
    tags: ['voiceover', 'voices'],
    input: z.object({ language: z.string().min(2).max(35).optional() }),
    output: voicesOutput,
    costClass: 'cloud',
    sideEffect: 'read',
    timeoutMs: 15_000,
    retry: { maxAttempts: 2, initialDelayMs: 1000 },
    cache: { ttlMs: HOUR_MS },
    permission: { network: 'internet', cloudModules: ['voice'] },
    estimateCost: () => ({ usd: 0, basis: 'the voice list is free at the provider' }),
    run: async (input, ctx) => {
      const voices = await deps.provider.voices({
        ...(input.language ? { language: input.language } : {}),
        signal: ctx.signal,
      });
      if (!voices.ok) return voices;
      const consents = deps.consents ? await deps.consents.list() : null;
      if (consents && !consents.ok) return consents;
      const own = new Set(consents?.value.flatMap((c) => (c.clone ? [c.clone.voiceId] : [])) ?? []);
      return ok({
        voices: voices.value.slice(0, 200).map((voice) => ({
          voiceId: voice.voiceId,
          name: voice.name.slice(0, 80),
          labels: voice.labels,
          own: own.has(voice.voiceId),
        })),
      });
    },
  });
}

/** The `voice` module: fit, list, generate, edit, place and finalize. */
export function voiceToolModule(deps: VoiceToolDeps): ToolModule {
  return defineToolModule({
    id: 'voice',
    tools: [fitScriptTool(deps), listVoicesTool(deps), ...voiceWriteTools(deps)],
  });
}
