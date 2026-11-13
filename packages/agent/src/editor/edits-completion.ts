// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ArtifactStore } from '@taalcut/core';
import type { RunState, StepState } from '../run-state';
import { readyExportIds } from './export-completion';
import { recordedToolReceipt } from './tool-receipt';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
const STAGE =
  /\b(?:put|stage|send|transfer|import|open|add|move|copy|bring|export)\b[^.!?;]{0,100}\b(?:to|into|in|on)\s+(?:(?:the|instagram|meta)\s+)*["'“]?edits\b/iu;
const INFORMATION =
  /^\s*(?:please\s+)?(?:how|why|what|which|where|when|is|are|does|did|explain|tell\s+me|(?:can|could|would|will)\s+you\s+(?:explain|describe|tell))\b/iu;
const NEGATED =
  /\b(?:do\s+not|don't|never|skip|avoid)\s+(?:put|stage|send|transfer|import|open|add|move|copy|bring|export)\b/iu;

const EXPORT_ACTION =
  /^\s*(?:please\s+)?(?:export|render|download)\b|\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:export|render|download)\b/iu;

function asksToStage(request: string): boolean {
  if (
    !request
      .split(/\b(?:and|then|also|but)\b|[.!?;,]/iu)
      .some((clause) => EXPORT_ACTION.test(clause) && !INFORMATION.test(clause) && !NEGATED.test(clause))
  )
    return false;
  return request
    .split(/\b(?:and|then|also|but)\b|[.!?;,]/iu)
    .some((clause) => STAGE.test(clause) && !INFORMATION.test(clause) && !NEGATED.test(clause));
}

/** Export is only the first half of an explicit export-to-Edits request. */
export async function editsHandoffProblem(
  state: RunState,
  step: StepState,
  handoff: unknown,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<string | undefined> {
  const input = asRecord(step.entered?.input ?? step.input);
  if (
    step.skill !== 'timeline.editor' ||
    !input ||
    typeof input.request !== 'string' ||
    !asksToStage(input.request)
  )
    return undefined;
  const output = asRecord(handoff);
  if (output?.timelineId !== input.timelineId)
    return 'The Edits handoff must refer to the timeline in this editing request.';
  const renders = await readyExportIds(state, input, output?.revision, artifacts);
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    const request = asRecord(call?.requested.input);
    const stagedInput = asRecord(request?.input);
    if (
      call?.requested.tool !== 'plugins.callExternal' ||
      request?.pluginId !== 'instagram-edits' ||
      request.toolName !== 'api.stageReel' ||
      typeof stagedInput?.renderId !== 'string' ||
      !renders.has(stagedInput.renderId)
    )
      continue;
    if (asRecord(await recordedToolReceipt(call, artifacts))?.staged === true) return undefined;
  }
  const reason = typeof output?.notStagedReason === 'string' ? normalize(output.notStagedReason) : '';
  if (reason && normalize(state.lastTurn?.text ?? '').includes(reason)) return undefined;
  return (
    'The requested video has not been staged in Instagram Edits. An export or plugin lookup alone does not complete this request. ' +
    'Use the available Instagram Edits plugin: read its skill and tool schema, then call plugins.callExternal with pluginId "instagram-edits", ' +
    'toolName "api.stageReel", and input.renderId from the completed export for this timeline revision. Require staged:true before claiming it is in Edits. ' +
    'Respect the existing external-action approval flow; stage only, never publish or share. If the plugin is unavailable, staging is declined or it fails, ' +
    'state that limitation visibly and repeat it verbatim in handOff.notStagedReason. Do not silently drop the Edits step.'
  );
}
