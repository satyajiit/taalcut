// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voiceover write tools (SPEC P3.9): `voice.generate`, `voice.editLine`, `voice.place`, `voice.finalize`. Each
 * reads the stored timeline, runs the voiceover service (generation is paid; placement is local) and applies the
 * result with one `voice.applyVoiceover`, so the change is one undo step with the same audit row as the card's
 * buttons. Sending a script is not an upload of the user's media: these are `write`, not `external`. Cloning,
 * recording and consent are never tools (SOUL boundaries; core's consent commands refuse the agent).
 */
import {
  defineTool,
  err,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  ValidationError,
  VOICE_COMMANDS,
  type AnyTool,
  type AsyncResult,
  type CommandToolContext,
  type GenerationTrace,
  type Timeline,
  type TimelineStore,
  type VoiceConsentStore,
  type VoiceProvider,
} from '@taalcut/core';
import { z } from 'zod';
import { readTimeline } from '../commands/timeline-writes';
import { VOICE_CONFIG } from '../voice/config';
import type { VoiceChoice, VoiceoverOutcome, VoiceoverService } from '../voice/voiceover';
import { ESTIMATE_BOUNDS, voiceEstimate, type GenerationPrices } from './prices';
import { refineEditLineCost, refineFinalizeCost } from './refine-costs';
import { inputKey } from './tool-keys';
import { voiceoverToolOutput, voiceoverToolOutputSchema } from './voice-output';

export interface VoiceToolDeps {
  readonly voiceover: Pick<VoiceoverService, 'generate' | 'editLine' | 'place' | 'finalize'>;
  readonly provider: Pick<VoiceProvider, 'voices'>;
  readonly timelines: TimelineStore;
  readonly prices: GenerationPrices;
  /** The user's consents: a voice cloned from one of them is their own. */
  readonly consents?: Pick<VoiceConsentStore, 'list'>;
}

const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') };
const voiceId = z.string().min(1).max(64).describe('A voice id from voice.listVoices');
const PAID = { network: 'internet', cloudModules: ['voice'] } as const;

const generateInput = z.object({
  ...target,
  lines: z
    .array(
      z.object({
        text: z.string().min(1).max(VOICE_CONFIG.maxLineChars).describe('What is said, written for the ear'),
        slotId: ulidSchema('TemplateSlot')
          .optional()
          .describe('The slot it belongs to; else the next free one'),
      }),
    )
    .min(1)
    .max(VOICE_CONFIG.maxLines),
  voiceId,
  language: z.string().min(2).max(35).describe("BCP 47 tag of the script's language, e.g. en, hi, es, pt-BR"),
});

const editInput = z.object({
  ...target,
  lineId: ulidSchema('VoiceLine'),
  text: z.string().min(1).max(VOICE_CONFIG.maxLineChars).optional(),
  voiceId: voiceId.optional().describe('A new voice: every line is generated again in it'),
});

const timelineInput = z.object(target);

const traceOf = (ctx: CommandToolContext, timeline: Timeline): GenerationTrace => ({
  ...(ctx.runId ? { runId: ctx.runId } : {}),
  projectId: timeline.projectId,
});

/** The voice's name and whether it is the user's own clone, from the provider's list. */
async function voiceChoice(deps: VoiceToolDeps, id: string, signal: AbortSignal): AsyncResult<VoiceChoice> {
  const voices = await deps.provider.voices({ signal });
  if (!voices.ok) return voices;
  const voice = voices.value.find((v) => v.voiceId === id);
  if (!voice)
    return err(
      ValidationError({ field: 'voiceId' }, { detail: `no voice ${id}: pick one from voice.listVoices` }),
    );
  const consents = deps.consents ? await deps.consents.list() : null;
  if (consents && !consents.ok) return consents;
  const own = consents?.value.some((consent) => consent.clone?.voiceId === id) ?? false;
  return ok({ voiceId: id, voiceName: voice.name.slice(0, 80), own });
}

/** Applies the outcome with the tool's command and reports what it cost. */
async function apply(ctx: CommandToolContext, made: VoiceoverOutcome) {
  if (made.costUsd > 0) ctx.reportUsage({ usd: made.costUsd });
  const done = await ctx.dispatch(made.payload);
  return done.ok ? ok(voiceoverToolOutput(made)) : done;
}

const common = {
  version: '1.0.0',
  output: voiceoverToolOutputSchema,
  sideEffect: 'write',
  command: VOICE_COMMANDS.applyVoiceover,
  retry: NO_TOOL_RETRY,
} as const;

function generateTool(deps: VoiceToolDeps) {
  return defineTool({
    ...common,
    name: 'voice.generate',
    description:
      'Generates a voiceover from script lines (one per slot, in order) as drafts on the fast model, places each ' +
      "line's first word on its slot's beat and applies it to the voice track. Run voice.fitScript first and " +
      'shorten lines it says are over. Paid. Undoable.',
    summary: 'Generates draft voiceover lines and places them on the beat.',
    tags: ['voiceover', 'narration', 'tts', 'script'],
    input: generateInput,
    costClass: 'paid',
    timeoutMs: 180_000,
    permission: PAID,
    idempotencyKey: (input) => inputKey('voice.generate', input),
    estimateCost: (input) =>
      voiceEstimate(
        deps.prices,
        input.lines.reduce((sum, line) => sum + line.text.length, 0),
        'draft',
        "the script's characters at the draft model's list price",
      ),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const voice = await voiceChoice(deps, input.voiceId, ctx.signal);
      if (!voice.ok) return voice;
      const made = await deps.voiceover.generate({
        timeline: timeline.value,
        script: input.lines,
        voice: voice.value,
        language: input.language,
        signal: ctx.signal,
        trace: traceOf(ctx, timeline.value),
      });
      return made.ok ? apply(ctx, made.value) : made;
    },
  });
}

function editLineTool(deps: VoiceToolDeps) {
  return defineTool({
    ...common,
    name: 'voice.editLine',
    description:
      'Generates one voiceover line again with new text, or the whole voiceover in a new voice, and re-places ' +
      'it on the beat. A line of a final voiceover goes straight to the final model. Paid. Undoable.',
    summary: 'Re-generates one voiceover line (or every line in a new voice) and re-places it.',
    tags: ['voiceover', 'edit', 'line'],
    input: editInput,
    costClass: 'paid',
    timeoutMs: 60_000,
    permission: PAID,
    idempotencyKey: (input) => inputKey('voice.editLine', input),
    estimateCost: (input) =>
      input.voiceId
        ? voiceEstimate(
            deps.prices,
            ESTIMATE_BOUNDS.voiceoverCharacters,
            'final',
            `a new voice regenerates every line: at most ${ESTIMATE_BOUNDS.voiceoverCharacters} characters at the final price`,
          )
        : voiceEstimate(
            deps.prices,
            input.text?.length ?? VOICE_CONFIG.maxLineChars,
            'final',
            "the line's characters at the final model's list price (an upper bound for a draft line)",
          ),
    refineCost: (input, ctx) => refineEditLineCost(deps, input, ctx),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const voice = input.voiceId ? await voiceChoice(deps, input.voiceId, ctx.signal) : null;
      if (voice && !voice.ok) return voice;
      const made = await deps.voiceover.editLine({
        timeline: timeline.value,
        lineId: input.lineId,
        ...(input.text ? { text: input.text } : {}),
        ...(voice ? { voice: voice.value } : {}),
        signal: ctx.signal,
        trace: traceOf(ctx, timeline.value),
      });
      return made.ok ? apply(ctx, made.value) : made;
    },
  });
}

function placeTool(deps: VoiceToolDeps) {
  return defineTool({
    ...common,
    name: 'voice.place',
    description:
      'Places the existing voiceover lines on the current timeline again (after cuts moved): each onset on its ' +
      "slot's beat, never overlapping, never past the end. Generates nothing. Undoable.",
    summary: 'Re-places the voiceover lines on the current timeline, generating nothing.',
    tags: ['voiceover', 'beat', 'qa', 'fix'],
    input: timelineInput,
    costClass: 'local',
    timeoutMs: 10_000,
    permission: { network: 'none' },
    idempotencyKey: (input) => inputKey('voice.place', input),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const made = await deps.voiceover.place({ timeline: timeline.value, signal: ctx.signal });
      return made.ok ? apply(ctx, made.value) : made;
    },
  });
}

function finalizeTool(deps: VoiceToolDeps) {
  return defineTool({
    ...common,
    name: 'voice.finalize',
    description:
      'Generates every draft voiceover line again on the final model, same text, voice and seed, and re-places ' +
      'them. Nothing to do when every line is final. Paid. Undoable.',
    summary: 'Makes every draft voiceover line final on the flagship model.',
    tags: ['voiceover', 'final', 'review'],
    input: timelineInput,
    costClass: 'paid',
    timeoutMs: 300_000,
    permission: PAID,
    idempotencyKey: (input) => inputKey('voice.finalize', input),
    estimateCost: () =>
      voiceEstimate(
        deps.prices,
        ESTIMATE_BOUNDS.voiceoverCharacters,
        'final',
        `at most ${ESTIMATE_BOUNDS.voiceoverCharacters} draft characters at the final model's list price`,
      ),
    refineCost: (input, ctx) => refineFinalizeCost(deps, input, ctx),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const made = await deps.voiceover.finalize({
        timeline: timeline.value,
        signal: ctx.signal,
        trace: traceOf(ctx, timeline.value),
      });
      return made.ok ? apply(ctx, made.value) : made;
    },
  });
}

export function voiceWriteTools(deps: VoiceToolDeps): AnyTool[] {
  return [generateTool(deps), editLineTool(deps), placeTool(deps), finalizeTool(deps)];
}
