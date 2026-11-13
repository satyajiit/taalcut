// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ArtifactStore } from '@taalcut/core';
import type { RunState, StepState } from '../run-state';
import { recordedToolReceipt } from './tool-receipt';
import { videoDeliveryClauses } from './cover-completion';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim();
const EXPORT_REQUEST =
  /\b(export\w*|render\w*|download|save\s+(?:the\s+)?video|4k|1080p|60\s*fps)\b|निर्यात/iu;
const EXPORT_ACTION =
  /(?:^|\b(?:and|then|please)\s+)(?:export\w*|render\w*|download|save\s+(?:the\s+)?video)\b|\b(?:can|could|would|will)\s+you\b[^.!?]{0,160}\b(?:export|render|download)\b/iu;

/** A read-only handoff is not evidence that the requested video was exported. */
export async function exportHandoffProblem(
  state: RunState,
  step: StepState,
  handoff: unknown,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<string | undefined> {
  const input = record(step.entered?.input ?? step.input);
  if (
    step.skill !== 'timeline.editor' ||
    typeof input?.request !== 'string' ||
    !EXPORT_REQUEST.test(videoDeliveryClauses(input.request))
  )
    return undefined;
  if (state.started?.editor?.route === 'answer' && !EXPORT_ACTION.test(input.request)) return undefined;
  const output = record(handoff);
  if (output?.timelineId !== input.timelineId)
    return 'The export handoff must refer to the timeline in this editing request.';
  if ((await readyExportIds(state, input, output?.revision, artifacts)).size > 0) return undefined;
  const reason = typeof output?.notExportedReason === 'string' ? normalized(output.notExportedReason) : '';
  if (reason && normalized(state.lastTurn?.text ?? '').includes(reason)) return undefined;
  return (
    'No completed export for this timeline and revision is recorded. Reading presets or changing the video ' +
    'does not export it. Configure the requested preset, codec and frame rate, then call render.export and wait ' +
    'for its result. If export is unavailable, declined or failed, explain that to the person and put that same ' +
    'explanation verbatim in handOff.notExportedReason. Do not report that a video was exported without its result.'
  );
}

/** Current-run authoritative exports matching the exact handoff revision. Shared by follow-on delivery checks. */
export async function readyExportIds(
  state: RunState,
  input: Readonly<Record<string, unknown>>,
  revision: unknown,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    const requested = record(call?.requested.input);
    if (
      call?.requested.tool !== 'render.export' ||
      call.outcome?.kind !== 'completed' ||
      requested?.projectId !== input.projectId ||
      requested?.timelineId !== input.timelineId ||
      requested?.timelineRevision !== revision
    )
      continue;
    const render = record(record(await recordedToolReceipt(call, artifacts))?.render);
    if (
      render?.status === 'ready' &&
      typeof render.id === 'string' &&
      render.projectId === input.projectId &&
      render.timelineId === input.timelineId &&
      render.timelineRevision === revision
    )
      ids.add(render.id);
  }
  return ids;
}
