// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverExportResultSchema, type ArtifactStore } from '@taalcut/core';
import type { RunState, StepState } from '../run-state';
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

/** Creating a cover is complete only when its current design was exported, or the limitation is visible. */
export async function coverHandoffProblem(
  state: RunState,
  step: StepState,
  handoff: unknown,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<string | undefined> {
  const input = asRecord(step.entered?.input ?? step.input);
  const request = input?.request;
  if (step.skill !== 'timeline.editor' || !input || typeof request !== 'string' || !asksForCover(request))
    return undefined;
  const output = asRecord(handoff);
  if (!output || output.timelineId !== input.timelineId)
    return 'The cover handoff must refer to the timeline in this editing request.';
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
      cover.success &&
      cover.data.revision === output.revision &&
      /^[^/\\]+\.jpe?g$/iu.test(cover.data.fileName)
    )
      return undefined;
  }
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const reason = typeof output?.notSavedCoverReason === 'string' ? normalize(output.notSavedCoverReason) : '';
  if (reason && normalize(state.lastTurn?.text ?? '').includes(reason)) return undefined;
  return (
    'No saved JPEG cover for this timeline and revision is recorded. A generated backdrop or changed cover ' +
    'settings are not a saved cover. Use timeline.setCover, then render.exportCover with its returned revision, ' +
    'and inspect the saved image before reporting completion. If the requested cover cannot be made, explain ' +
    'that visibly and repeat the explanation verbatim in handOff.notSavedCoverReason. Use the available image ' +
    'provider routes, including supported subscription sign-ins; do not silently substitute footage for requested AI imagery.'
  );
}
