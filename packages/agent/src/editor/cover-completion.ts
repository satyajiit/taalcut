// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverExportResultSchema, type ArtifactStore, type CoverRequest } from '@taalcut/core';
import type { RunState, StepState } from '../run-state';
import { coverMediumProblem, coverSaves, generatedAssets } from './cover-medium';
import { recordedToolReceipt } from './tool-receipt';

const COVER = /\b(?:thumbnails?|covers?)\b/iu;
const ACTION =
  /\b(?:create|make|making|generate|build|design|save|export|render|download|want|need|redo|redesign|fix|change|update)\b/iu;
const INFORMATION =
  /^\s*(?:how|why|what|which|where|when|is|are|does|do\s+(?:I|we|you)|explain|tell\s+me\s+(?:how|why|what)|(?:can|could|would|will)\s+you\s+(?:explain|describe|tell|show))\b/iu;
const VIDEO_DELIVERY =
  /\b(?:export\w*|render\w*|download|save)\s+(?:(?:the|my|our|current|finished|this|final|a|4k|1080p|60\s*fps)\s+)*(?:video|reel|cut|film|movie)\b(?!['’]s?\s+(?:cover|thumbnail)|\s+(?:cover|thumbnail))/iu;
const VIDEO_TARGET =
  /^\s*(?:(?:the|my|our|current|finished|this|final|a)\s+)*(?:video|reel|cut|film|movie)\b/iu;
const DELIVERY = /\b(?:export\w*|render\w*|download|save)\b/iu;
const VIDEO_FORMAT = /\d+(?:\.\d+)?\s*fps\b|\b(?:4k\s*60|hevc|h\.?26[45]|mp4|mov)\b/iu;
const NO_COVER =
  /\b(?:without|no|skip|remove|delete|do\s+not|don't)\b[^.!?]{0,40}\b(?:thumbnail|cover)s?\b/iu;
const clauses = (request: string) => request.split(/\b(?:and|then|also)\b|[.!?;]/iu);
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Cover-only delivery is not a request to export a second video. Compound requests retain the video clause. */
export function videoDeliveryClauses(request: string): string {
  if (!COVER.test(request)) return request;
  let coverSeen = false;
  for (const clause of clauses(request)) {
    if (VIDEO_DELIVERY.test(clause)) return request;
    if (COVER.test(clause)) {
      coverSeen = true;
      continue;
    }
    if (VIDEO_TARGET.test(clause) && DELIVERY.test(request)) return request;
    // "Export it" before a cover is mentioned targets the video; after a named cover it targets that still.
    if (DELIVERY.test(clause) && (!coverSeen || VIDEO_FORMAT.test(clause))) return request;
  }
  return '';
}

function asksForCover(request: string): boolean {
  const sharedAction = ACTION.test(request) && !INFORMATION.test(request);
  return clauses(request).some(
    (clause) =>
      COVER.test(clause) &&
      !INFORMATION.test(clause) &&
      !NO_COVER.test(clause) &&
      (ACTION.test(clause) ||
        (sharedAction && /^\s*(?:(?:the|my|a)\s+)?(?:covers?|thumbnails?)\b/iu.test(clause))),
  );
}

/**
 * CVR1: the cover the run's message asked for in the editor's cover panel ("Generate with AI"), when this step
 * edits the timeline it was asked on. Its aspect is data from the panel, so the step owes a cover at that aspect
 * whatever language or words the message is in.
 */
function owedCover(state: RunState, input: Record<string, unknown>): CoverRequest | undefined {
  const brief = state.started?.editor;
  return brief?.cover && brief.context.timelineId === input.timelineId ? brief.cover : undefined;
}

/** CVR1: true when a width and height are in `aspect` ("9:16"), within a pixel of rounding. */
function inAspect(width: number, height: number, aspect: CoverRequest['aspect']): boolean {
  const [across = 1, down = 1] = aspect.split(':').map(Number);
  return Math.abs(width * down - height * across) <= Math.max(across, down);
}

/**
 * Creating a cover is complete only when its current design was exported, or the limitation is visible. CVR1: a
 * cover asked for in the cover panel is owed at the panel's aspect: saved at it in this run and exported at it.
 * CVR2: the cover saved last is what its stated medium means (cover-medium.ts): a designed composition over the
 * video's own footage unless the person asked for other art.
 */
export async function coverHandoffProblem(
  state: RunState,
  step: StepState,
  handoff: unknown,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<string | undefined> {
  const input = asRecord(step.entered?.input ?? step.input);
  if (step.skill !== 'timeline.editor' || !input) return undefined;
  const owed = owedCover(state, input);
  if (!owed && (typeof input.request !== 'string' || !asksForCover(input.request))) return undefined;
  const output = asRecord(handoff);
  if (!output || output.timelineId !== input.timelineId)
    return 'The cover handoff must refer to the timeline in this editing request.';
  const saves = coverSaves(state, input);
  const last = owed ? saves.findLast((save) => save.aspect === owed.aspect) : saves.at(-1);
  const saved = !owed || last !== undefined;
  const medium = last ? coverMediumProblem(last, owed, await generatedAssets(state, artifacts)) : undefined;
  let exported = false;
  let other = '';
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    const requested = asRecord(call?.requested.input);
    if (
      call?.requested.tool !== 'render.exportCover' ||
      requested?.projectId !== input.projectId ||
      requested?.timelineId !== input.timelineId ||
      requested?.revision !== output?.revision
    )
      continue;
    const cover = coverExportResultSchema.safeParse(await recordedToolReceipt(call, artifacts));
    if (
      !cover.success ||
      cover.data.revision !== output.revision ||
      !/^[^/\\]+\.jpe?g$/iu.test(cover.data.fileName)
    )
      continue;
    if (!owed) {
      exported = true;
      break;
    }
    if (inAspect(cover.data.width, cover.data.height, owed.aspect)) exported = true;
    else
      other = ` The JPEG exported at this revision is ${cover.data.width}x${cover.data.height}, not ${owed.aspect}.`;
  }
  if (saved && exported && !medium) return undefined;
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const reason = typeof output?.notSavedCoverReason === 'string' ? normalize(output.notSavedCoverReason) : '';
  if (reason && normalize(state.lastTurn?.text ?? '').includes(reason)) return undefined;
  if (saved && exported && medium) return medium;
  if (owed)
    return (
      `The user asked for this cover at ${owed.aspect} in the editor's cover panel, so the step owes a cover at ` +
      `${owed.aspect}.` +
      (saved
        ? ''
        : ` No cover was saved at ${owed.aspect} in this run; exporting an earlier cover is not it.`) +
      (exported ? '' : ` No JPEG at ${owed.aspect} for this timeline and revision is recorded.${other}`) +
      (medium ? ` ${medium}` : '') +
      ` Save the cover with workspace.placeCover and aspect "${owed.aspect}", then call render.exportCover ` +
      `with aspect "${owed.aspect}" and the revision it returned, and inspect the saved image before ` +
      `reporting completion. If a cover at ${owed.aspect} cannot be made, explain that visibly and repeat the ` +
      'explanation verbatim in handOff.notSavedCoverReason.'
    );
  return (
    'No saved JPEG cover for this timeline and revision is recorded. A generated backdrop or changed cover ' +
    'settings are not a saved cover. Save the designed cover with workspace.placeCover, then render.exportCover ' +
    'with its returned revision, and inspect the saved image before reporting completion. If the requested cover ' +
    'cannot be made, explain that visibly and repeat the explanation verbatim in handOff.notSavedCoverReason. ' +
    'When the person asked for generated art, use the available image provider routes, including supported ' +
    'subscription sign-ins, and never present footage as that art.'
  );
}
