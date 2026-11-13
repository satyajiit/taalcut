// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `images.generateForSlot` (P3-B7): makes stills for one slot from a prompt the agent wrote, keeps every take
 * in the library byte for byte (image-takes.ts), and fills the slot's gap with the first through
 * `timeline.fillGap`, so the change has the UI's undo and audit row. A still moves gently in the render
 * (render's still motion). A slot that holds a clip keeps it: a tool dispatches only the command it declares
 * (core's ToolSpec.command), so replacing a weak clip is the timeline's `timeline.swapClip` with the
 * returned take.
 */
import {
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  TIMELINE_COMMANDS,
  type AsyncResult,
  type CommandToolContext,
  type TaalcutError,
  type ToolCostEstimate,
  type ToolModule,
} from '@taalcut/core';
import {
  chainEstimate,
  generateImages,
  refineImageCost,
  type ImageChainDeps,
  type ImageGeneration,
} from './image-chain';
import { promptText } from './image-provider';
import { slotPlace, type SlotItem } from './image-slot';
import { imageTakesCard, keepTakes } from './image-takes';
import {
  generateForSlotInput,
  generateForSlotKey,
  generateForSlotOutput,
  sha256Hex,
  type GenerateForSlotInput,
  type GenerateForSlotResult,
} from './image-tool-io';
import type { ImageAspect, ImageRequest } from './image-types';
import { createGenerateThumbnailTool } from './thumbnail-tool';
import {
  GENERATE_FOR_SLOT_TIMEOUT_MS,
  type ImageToolDeps,
  type ThumbnailStoredStillInput,
} from './thumbnail-tool-io';

export { GENERATE_FOR_SLOT_TIMEOUT_MS, type ImageToolDeps, type ThumbnailStoredStillInput };

export function createGenerateForSlotTool(deps: ImageToolDeps) {
  const now = deps.now ?? Date.now;
  return defineTool({
    name: 'images.generateForSlot',
    version: '1.1.0',
    description:
      'Generates a still for one slot from a prompt and places it there; other takes stay as alternates. ' +
      'Use it for a gap no clip of the user fits, when the user agrees to a generated image. The prompt ' +
      'describes the scene from the slot intent and the template look; never a real person or their likeness. ' +
      'Uses the configured image subscription or API key; subscription quota is managed by the provider. ' +
      'Nothing of the user is sent. A slot that already holds a clip keeps it: swap a take in ' +
      'with timeline.swapClip if it should replace the clip.',
    summary: 'Generates a still for one slot from a prompt and places it there.',
    tags: ['image', 'generate', 'still', 'gap', 'fill', 'picture', 'ai-image'],
    input: generateForSlotInput,
    output: generateForSlotOutput,
    costClass: 'paid',
    sideEffect: 'write',
    command: TIMELINE_COMMANDS.fillGap,
    timeoutMs: GENERATE_FOR_SLOT_TIMEOUT_MS,
    // A retry would pay again: the chain already falls back across keys and models.
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', cloudModules: ['images'] },
    idempotencyKey: generateForSlotKey,
    estimateCost: (input) => costEstimate(deps, input),
    refineCost: (input, ctx) => refineImageCost(deps, { size: 'final', count: input.count }, ctx.signal),
    async run(input, ctx) {
      const place = await slotPlace(deps.timelines, input);
      if (!place.ok) return place;
      const request = slotRequest(input, place.value.aspect, ctx);
      const made = await generateImages(deps, request);
      if (!made.ok) return made;
      const costUsd = made.value.images.reduce((sum, image) => sum + image.costUsd, 0);
      const assets = await keepTakes(deps.sink, made.value.images, {
        input,
        ctx,
        promptSha256: sha256Hex(promptText(request)),
        now,
      });
      if (!assets.ok) return assets;
      const result = {
        projectId: input.projectId,
        timelineId: input.timelineId,
        slotId: input.slotId,
        assets: assets.value,
        costUsd,
        fallbacks: fallbackRows(made.value),
        placed: null,
      };
      return placeFirstTake(result, place.value.item, ctx);
    },
    async resultCard(output, ctx) {
      return ok(imageTakesCard(output, ctx));
    },
  });
}

/** The images tool module for the agent process's registry. */
export function imageToolModule(deps: ImageToolDeps): ToolModule {
  return defineToolModule({
    id: 'images',
    tools: [createGenerateForSlotTool(deps), createGenerateThumbnailTool(deps)],
  });
}

export const createImageToolModule = imageToolModule;

function costEstimate(deps: ImageChainDeps, input: GenerateForSlotInput): ToolCostEstimate {
  // Billed per image: the cost card says "2 images", not "0 tokens" (review M8).
  const billed = { unit: 'image', quantity: input.count } as const;
  const estimate = chainEstimate(deps, { size: 'final', count: input.count });
  if (!estimate)
    return {
      usd: 0,
      billed,
      basis: 'The image route has no API price; subscription allowance is checked before running',
    };
  const about = estimate.estimated ? ' (token-priced, about)' : '';
  return {
    usd: estimate.usd,
    billed,
    basis: `${input.count} × ${estimate.model} at the dearest route${about}`,
  };
}

/** The chain's request for this slot: the canvas's aspect unless the agent asked for another. */
function slotRequest(
  input: GenerateForSlotInput,
  canvas: ImageAspect,
  ctx: CommandToolContext,
): ImageRequest {
  return {
    prompt: input.prompt,
    aspect: input.aspect ?? canvas,
    size: 'final',
    count: input.count,
    ...(input.avoid ? { avoid: input.avoid } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    signal: ctx.signal,
    ...(ctx.estimate?.billing === 'subscription' ? { requiredAccess: 'subscription' as const } : {}),
    // Each billed call is reported as it happens, so a call that fails later still counts what it spent and its
    // idempotency key keeps the error (the executor, review H2).
    onCharge: (charge) => ctx.reportUsage(charge),
    trace: { spanId: ctx.callId, projectId: input.projectId, ...(ctx.runId ? { runId: ctx.runId } : {}) },
  };
}

function fallbackRows(made: ImageGeneration): GenerateForSlotResult['fallbacks'] {
  return made.fallbacks.map((f) => ({
    from: `${f.from.provider}/${f.from.model}`,
    to: `${f.to.provider}/${f.to.model}`,
    reason: f.reason.code,
  }));
}

/** Fills the slot's gap with the first take; a slot that holds a clip keeps it and says why. */
async function placeFirstTake(
  result: GenerateForSlotResult,
  item: SlotItem,
  ctx: CommandToolContext,
): AsyncResult<GenerateForSlotResult> {
  const take = result.assets[0];
  if (item.kind === 'clip' || !take)
    return ok({ ...result, notPlaced: item.kind === 'clip' && item.locked ? 'lockedClip' : 'clip' });
  const placed = await ctx.dispatch({
    projectId: result.projectId,
    timelineId: result.timelineId,
    gapId: item.itemId,
    media: { kind: 'image', assetId: take.assetId, stillMotion: 'pushIn' },
  });
  return placed.ok ? ok({ ...result, placed: take.assetId }) : err(withKeptTakes(placed.error, result));
}

/**
 * The fill failed after the stills were paid for and kept: the error names them, so the model (and a repeat of
 * the call, which the executor answers with this same error) can place one rather than pay again (review H2).
 */
function withKeptTakes(error: TaalcutError, result: GenerateForSlotResult): TaalcutError {
  const ids = result.assets.map((asset) => asset.assetId).join(', ');
  const kept = `the ${result.assets.length} paid takes are kept in the library as ${ids}; place one, don't generate again`;
  return { ...error, detail: error.detail ? `${error.detail}; ${kept}` : kept };
}
