// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `captions.translate` (P3-V20, SPEC P3.9): the timeline's captions into one of the four app languages, applied
 * with render's `captions.applyTranslation` (undo restores the source track). Registered by placement, like
 * `vision.describeFrame`: on this Mac it is a local write; with the agent chain in the cloud it is a cloud write
 * under the `agent` module (Local only refuses it, the project cap counts it). With no model chosen yet it is
 * offered as the cloud write, like vision's describeFrame, and the call says what is missing: the registry is
 * built once, at start, and a model chosen later must find the tool there.
 * Caption text is what someone said, so the translator fences it; the tool returns counts, never the text.
 * Module id `captions`: the agent root offers it with render's caption tools as one module; its routing family is
 * `translation`, so skills that load the `captions` family (the Editor's caption fixes) don't get it.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  APP_LOCALES,
  CAPTION_COMMANDS,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type TextTranslator,
  type TimelineStore,
  type ToolCostEstimate,
  type ToolModule,
  type ToolUsage,
} from '@taalcut/core';
import { readTimeline } from '../commands/timeline-writes';
import type { CaptionTranslation, CaptionTranslator } from '../translate/caption-translator';

export interface TranslateToolDeps {
  readonly captions: CaptionTranslator;
  /** Where translation runs now (models' TextTranslator): decides how the tool registers. */
  readonly translator: Pick<TextTranslator, 'placement'>;
  readonly timelines: TimelineStore;
  /** One translation of a caption track at the agent chain's price (models' price lookup); US$0 on this Mac. */
  readonly estimate: () => ToolCostEstimate;
}

export const TRANSLATE_TIMEOUT_MS = 120_000;

export const captionsTranslateInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  language: z.enum(APP_LOCALES).describe('The language to translate the captions into'),
  revision: z
    .int()
    .positive()
    .optional()
    .describe('The timeline revision you last read; a newer one is a conflict'),
});

export const captionsTranslateOutputSchema = z.object({
  cues: z.int().nonnegative().describe('Cues translated'),
  shortened: z.int().nonnegative().describe('Sentences translated again shorter to fit their cues'),
  model: z.string(),
  local: z.boolean().describe('Translated on this Mac'),
});

const LOCAL_NOTE = 'Runs on this Mac; the captions never leave the device.';
const CLOUD_NOTE = "Sends the caption text (not the media) to the cloud model in the user's agent profile.";

/** What the translation's model calls used, for `ctx.reportUsage`; undefined when they used nothing. */
function spentOn({ usage, provider, model }: CaptionTranslation): ToolUsage | undefined {
  if (usage.usd <= 0 && usage.inputTokens + usage.outputTokens <= 0) return undefined;
  return {
    usd: usage.usd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    provider,
    model,
  };
}

export function translateToolModule(deps: TranslateToolDeps): ToolModule {
  const cloud = deps.translator.placement() !== 'local';
  const translate = defineTool({
    name: 'captions.translate',
    version: '1.0.0',
    description:
      "Translates a timeline's captions into English (en), Hindi (hi), Spanish (es) or Brazilian Portuguese " +
      '(pt-BR), sentence by sentence, keeping every cue on its timing; a sentence too long for its cues is ' +
      `translated again shorter. Render picks a font for the script. ${cloud ? CLOUD_NOTE : LOCAL_NOTE} Undoable.`,
    summary: "Translates a timeline's captions into en, hi, es or pt-BR on their timing.",
    // Its own routing family: the Editor loads the `captions` family for QA caption fixes, and a paid
    // translation is not one of those.
    family: 'translation',
    tags: ['captions', 'subtitles', 'translate', 'language', 'localise'],
    input: captionsTranslateInputSchema,
    output: captionsTranslateOutputSchema,
    costClass: cloud ? 'cloud' : 'local',
    sideEffect: 'write',
    command: CAPTION_COMMANDS.applyTranslation,
    timeoutMs: TRANSLATE_TIMEOUT_MS,
    retry: NO_TOOL_RETRY,
    permission: cloud ? { network: 'internet', cloudModules: ['agent'] } : { network: 'none' },
    idempotencyKey: (input) =>
      createHash('sha256')
        .update(
          JSON.stringify([
            'captions.translate',
            input.projectId,
            input.timelineId,
            input.language,
            input.revision ?? null,
          ]),
        )
        .digest('hex'),
    ...(cloud ? { estimateCost: () => deps.estimate() } : {}),
    run: async (input, ctx) => {
      const timeline = await readTimeline(deps.timelines, input);
      if (!timeline.ok) return timeline;
      const translated = await deps.captions.translate({
        timeline: timeline.value,
        language: input.language,
        signal: ctx.signal,
        trace: {
          spanId: ctx.callId,
          projectId: timeline.value.projectId,
          ...(ctx.runId ? { runId: ctx.runId } : {}),
        },
      });
      if (!translated.ok) return translated;
      // Before the dispatch: the model calls are paid for even when applying them fails (review M8, H2).
      const spent = spentOn(translated.value);
      if (spent) ctx.reportUsage(spent);
      const applied = await ctx.dispatch(translated.value.payload);
      if (!applied.ok) return applied;
      return ok({
        cues: translated.value.cues,
        shortened: translated.value.shortened,
        model: translated.value.model,
        local: translated.value.local,
      });
    },
  });
  return defineToolModule({ id: 'captions', tools: [translate] });
}
