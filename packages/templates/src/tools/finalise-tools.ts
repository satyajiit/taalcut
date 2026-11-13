// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turning a breakdown into a template (P2-T4, P2-T5): the Analyst's verdicts on
 * disputed cuts resolve the slots, its intents fill them, and finalise saves
 * version 1 through template.create (one undo entry), keeps the reel's video
 * and music with it (REF1, keep-media.ts) and then discards the experiment.
 * The template, its low-res contact sheet and its reel stay.
 *
 * A dispute and a page at a time (LRN1-CTX, SPEC "Writing the slots a page
 * at a time"): judgeCut stores a verdict and hands out the next disputed cut,
 * resolveCuts hands out the next slots without an intent (as many as the
 * model's window holds), setIntents stores a page's intents (intent-tools.ts;
 * both savers: the agent shows the turns before them as one line), and
 * finalise reads it all from the store (`breakdown/slot-context-progress.ts`).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineTool,
  err,
  NO_TOOL_RETRY,
  ok,
  TEMPLATE_COMMANDS,
  ValidationError,
  type ExperimentId,
  type TemplateEditResult,
  type TemplateMedia,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { buildTemplate, resolveCuts, type SlotIntentInput } from '../breakdown/build-template';
import type { BreakdownDraft } from '../breakdown/draft';
import { graphicReading, readGraphicsFile, withGraphicReading } from '../breakdown/graphic-brief';
import { readLooks } from '../breakdown/looks';
import { slotContextLimitsFor, withSlotContext } from '../breakdown/slot-context';
import { judging } from '../breakdown/slot-context-disputes';
import { fitPage, slotPageFor } from '../breakdown/slot-context-pages';
import {
  intentsOf,
  readProgress,
  slotFrame,
  unwritten,
  updateProgress,
  withVerdict,
} from '../breakdown/slot-context-progress';
import type { DraftCache, TemplateToolDeps } from './deps';
import { discardExperiment } from './discard';
import { keepReference } from './keep-media';
import {
  finaliseInputSchema,
  judgeCutInputSchema,
  judgeCutOutputSchema,
  resolveCutsInputSchema,
  resolveCutsOutputSchema,
  templateRefOutputSchema,
} from './schemas';

const MINUTE = 60_000;

export const finaliseOutputSchema = templateRefOutputSchema.extend({
  slotCount: z.int().min(1),
  /** Cuts only one method found and no verdict confirmed: say so to the user. */
  unconfirmedCuts: z.array(z.int()),
  /** The breakdown's experiment, now discarded. */
  breakdownId: ulidSchema('Experiment'),
  /** REF1: the reel's video and music kept with the template on this Mac; null when none could be kept. */
  media: z.object({ bytes: z.int().positive(), hasAudio: z.boolean() }).nullable(),
});

export function judgeCutTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.judgeCut',
    // 1.0.1: a shorter description; what a verdict means is on `cut`.
    version: '1.0.1',
    summary: 'Stores a verdict on one disputed cut of a breakdown and returns the next cut to judge.',
    description:
      'Stores your verdict on one disputed cut and returns the next to judge (next, with its frames), until ' +
      'none is left; then call templates.resolveCuts.',
    tags: ['breakdown', 'cuts', 'verdicts'],
    input: judgeCutInputSchema,
    output: judgeCutOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    // What the model looked at to judge it is stored now (agent SPEC "Saved progress").
    savesProgress: true,
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch'], write: ['scratch'] } },
    run: async (input) => {
      const loaded = await drafts.load(input.breakdownId);
      if (!loaded.ok) return loaded;
      const { draft, dir } = loaded.value;
      if (!draft.disputes.some((dispute) => dispute.frame === input.at)) {
        const progress = await readProgress(dir);
        const { next } = judging(draft, progress.ok ? progress.value.verdicts : [], dir);
        return err(
          ValidationError(
            { field: 'at' },
            {
              detail:
                `No disputed cut at frame ${input.at}` +
                (next ? `: the next to judge is at frame ${next.at}.` : ': every disputed cut is judged.'),
            },
          ),
        );
      }
      const stored = await updateProgress(dir, (current) => ok(withVerdict(current, input)));
      if (!stored.ok) return stored;
      return ok(judging(draft, stored.value.verdicts, dir));
    },
  });
}

export function resolveCutsTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.resolveCuts',
    // 3.0.0 (LRN1-CTX): the verdicts come from templates.judgeCut; the page is as many slots as the window holds.
    // 3.0.1: a shorter description.
    version: '3.0.1',
    summary: "Resolves a breakdown's cuts and returns the next slots to write intents for.",
    // Description, summary and tags are what the model is offered and what findTools ranks by, and recorded
    // sessions match on the tools offered (gate-demo cassettes), so the page size, which follows the model's
    // window, isn't in them; each slot's context is explained in the Analyst's prompt.
    description:
      'Returns the next page of slots without an intent, each with its frame and context, and how many of all ' +
      'the slots have one. Write the page with templates.setIntents, then call again.',
    tags: ['breakdown', 'cuts', 'slots'],
    input: resolveCutsInputSchema,
    output: resolveCutsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch'] } },
    run: async (input) => {
      const loaded = await drafts.load(input.breakdownId);
      if (!loaded.ok) return loaded;
      const { draft, dir } = loaded.value;
      const progress = await readProgress(dir);
      if (!progress.ok) return progress;
      const { slots } = resolveCuts(draft, progress.value.verdicts);
      const looks = await readLooks(dir);
      const window = deps.contextWindow?.();
      // Context for every slot at the window's caps, then the page: the shared text level is the same on every page.
      const open = unwritten(progress.value, withSlotContext(draft, slots, slotContextLimitsFor(window)));
      const render = (page: readonly (typeof open)[number][]) => ({
        total: slots.length,
        written: slots.length - open.length,
        slots: page.map((slot) => {
          const frame = slotFrame(draft, slot);
          // BRK1 looks: a described strip comes as words, not a frame to look at again (or to mistype).
          const look = frame === null ? undefined : looks[frame];
          return look
            ? { index: slot.index, frame: null, context: { ...slot.context, looks: look } }
            : { index: slot.index, frame: frame === null ? null : join(dir, frame), context: slot.context };
        }),
      });
      // As many as the model's window holds, and no more than stay in the prompt rather than an artifact.
      return ok(render(fitPage(open.slice(0, slotPageFor(window)), render)));
    },
  });
}

/** Keeps the low-res contact sheet as a template asset; a template without one is still a template. */
async function keepContactSheet(
  deps: TemplateToolDeps,
  draft: BreakdownDraft,
  dir: string,
): Promise<string | null> {
  if (!draft.contactSheet) return null;
  try {
    const bytes = await readFile(join(dir, draft.contactSheet.path));
    const stored = await deps.store.putAsset(new Uint8Array(bytes), draft.contactSheet.mediaType);
    return stored.ok ? stored.value.sha256 : null;
  } catch {
    return null;
  }
}

/**
 * The verdicts and intents templates.judgeCut and templates.setIntents stored, and the cuts no verdict
 * confirmed. A slot without an intent is refused here: the frames to write it from go with the reference.
 */
async function storedWork(draft: BreakdownDraft, dir: string) {
  const progress = await readProgress(dir);
  if (!progress.ok) return progress;
  const { verdicts } = progress.value;
  const { slots, unconfirmed } = resolveCuts(draft, verdicts);
  const open = unwritten(progress.value, slots);
  if (open.length > 0)
    return err(
      ValidationError(
        { field: 'intents' },
        {
          detail:
            `${open.length} of ${slots.length} slots have no intent yet (first: slot ${open[0]?.index}). ` +
            'Call templates.resolveCuts for them and templates.setIntents, then finalise again.',
        },
      ),
    );
  return ok({ verdicts, intents: intentsOf(progress.value, slots), unconfirmed });
}

/** FIX-CAST: a slot whose intent has no `reel` keeps its looks (what its strip showed) as what the reel shows. */
async function withLooksAsReel(
  draft: BreakdownDraft,
  dir: string,
  verdicts: Parameters<typeof resolveCuts>[1],
  intents: readonly SlotIntentInput[],
) {
  const looks = await readLooks(dir);
  const { slots } = resolveCuts(draft, verdicts);
  return intents.map((item) => {
    const slot = slots[item.slotIndex];
    const frame = slot ? slotFrame(draft, slot) : null;
    const look = frame === null ? undefined : looks[frame]?.trim();
    return item.intent.reel || !look
      ? item
      : { ...item, intent: { ...item.intent, reel: look.slice(0, 500) } };
  });
}

export function finaliseTool(deps: TemplateToolDeps, drafts: DraftCache) {
  return defineTool({
    name: 'templates.finalise',
    // 2.0.0 (LRN1-CTX): the verdicts and intents come from templates.judgeCut and templates.setIntents.
    // 2.0.1: a shorter description. 2.1.0 (REF1): the reel's video and music are kept with the template.
    // 2.2.0 (BRK1's gate): no contact sheet hash in the output. No tool opens it, and a small model kept asking
    // readArtifact for it; the template keeps the sheet (`contactSheet.asset`), and its card shows it.
    version: '2.2.0',
    summary: "Saves a breakdown as a new template (version 1), keeping the reel's video and music with it.",
    description:
      'Saves a breakdown as a new template from the verdicts and intents you stored, once every slot has an ' +
      "intent. The reel's video and music are kept with it on this Mac; the scratch files go. Undoable.",
    tags: ['template', 'save', 'finalise', 'slots', 'intent'],
    input: finaliseInputSchema,
    output: finaliseOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: TEMPLATE_COMMANDS.create,
    timeoutMs: 2 * MINUTE,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch'], write: ['library', 'scratch'] } },
    idempotencyKey: (input) => `finalise:${input.breakdownId}`,
    run: async (input, ctx) => {
      const loaded = await drafts.load(input.breakdownId);
      if (!loaded.ok) return loaded;
      const { draft, dir } = loaded.value;
      const stored = await storedWork(draft, dir);
      if (!stored.ok) return stored;
      const { verdicts, unconfirmed } = stored.value;
      const intents = await withLooksAsReel(draft, dir, verdicts, stored.value.intents);
      const sheet = await keepContactSheet(deps, draft, dir);
      const built = buildTemplate(draft, verdicts, intents, deps.ids, {
        createdAt: deps.clock.now(),
        contactSheetAsset: sheet,
      });
      if (!built.ok) return built;
      // DSG1-READ: the reel's graphics read as design, from the model's saved answers and the template's facts.
      const template = withGraphicReading(
        built.value,
        graphicReading(built.value, draft, await readGraphicsFile(dir)),
      );
      const created = await ctx.dispatch({
        projectId: input.projectId,
        template,
        name: input.name,
        listed: true,
      });
      if (!created.ok) return created;
      // A repeat with the same key gets the first call's template from the bus: report that one.
      const { templateId, version } = created.value as TemplateEditResult;
      // REF1: the reel is kept before its scratch goes. A store that refuses leaves the template without media
      // (its page offers to fetch it again); the template is saved either way.
      const kept = await keepReference(deps.media, templateId, draft, dir);
      const media: TemplateMedia | null = kept.ok ? kept.value : null;
      // The frames, the sheet's scratch copy and anything left of the download go now. If the disk refuses, the
      // call fails with the scratch still present; calling again finds the saved template (same key) and retries.
      const discarded = await discardExperiment(deps.sandbox, input.breakdownId as ExperimentId);
      if (!discarded.ok) return discarded;
      drafts.forget(input.breakdownId);
      drafts.finalised?.(input.breakdownId, templateId);
      return ok({
        templateId,
        version,
        slotCount: template.slots.length,
        unconfirmedCuts: [...unconfirmed],
        breakdownId: input.breakdownId,
        media: media ? { bytes: media.bytes, hasAudio: media.hasAudio } : null,
      });
    },
  });
}
