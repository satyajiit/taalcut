// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RunState, StepState } from '../run-state';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim();
const POST_CAPTION =
  /\b(?:ig|instagram|post|social\s+media)\s+(?:post\s+)?captions?\b|\bcaptions?\s+(?:for|of)\s+(?:(?:the|my|an?|our)\s+)?(?:ig|instagram|post)\b/iu;
const WRITE_COPY = /\b(?:write|draft|create|generate|give|suggest|need|want|mean|meant)\b/iu;
const SUBTITLE_CONTROL =
  /\b(?:turn\s+(?:off|on)|disable|enable|resize)\b[^.!?]{0,50}\b(?:captions?|subtitles?)\b|\b(?:captions?|subtitles?)\b[^.!?]{0,50}\b(?:larger|smaller|font|size|position|timing)\b/iu;

/** A timeline changes card cannot deliver the post copy the person asked to read. */
export function postCaptionHandoffProblem(state: RunState, step: StepState, handoff: unknown) {
  const input = record(step.entered?.input ?? step.input);
  if (
    step.skill !== 'timeline.editor' ||
    typeof input?.request !== 'string' ||
    !input.request
      .split(/\b(?:and|then|also)\b|[.!?;]/iu)
      .some(
        (clause) => POST_CAPTION.test(clause) && WRITE_COPY.test(clause) && !SUBTITLE_CONTROL.test(clause),
      )
  )
    return undefined;
  const output = record(handoff);
  const caption = typeof output?.postCaption === 'string' ? normalized(output.postCaption) : '';
  if (caption && normalized(state.lastTurn?.text ?? '').includes(caption)) return undefined;
  return (
    'The person asked for a social post caption, not subtitles. Write the actual ready-to-copy post caption ' +
    'in your visible response and repeat it verbatim in handOff.postCaption. Changing subtitle settings ' +
    'or saying that the caption is done does not deliver the requested text. Preserve subtitle settings ' +
    'unless the person separately asked to change them.'
  );
}
