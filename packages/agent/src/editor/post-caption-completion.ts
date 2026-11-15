// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: what the Editor owes when a post caption is asked for. A caption is delivered by `timeline.setPostCaption`
 * (the tool holds it to the platform's rule and saves it with the video), so the check reads what the run did:
 *
 * - Asked in the caption panel (`brief.postCaption`, data from the panel's own control): the step cannot hand off
 *   until a caption for that platform was saved in this run. The panel shows it.
 * - Saved from the chat: the person reads the chat, so the saved text must be in the visible answer.
 * - Asked in the chat's own words and nothing saved: the step is sent back. That the words ask for post copy is
 *   still read by `asksForPostCaption` below, an English pattern over the person's message. It is kept because it
 *   is the one reading that does not depend on the model's own: a model that took "caption" for subtitles states
 *   nothing a check could hold it to.
 *
 * A caption that cannot be written is said visibly and repeated in `handOff.notSavedPostCaptionReason`.
 */
import {
  POST_CAPTION_COMMAND,
  postCaptionResultSchema,
  postCaptionRule,
  type ArtifactStore,
  type PostCaptionRequest,
  type PostCaptionResult,
} from '@taalcut/core';
import type { RunState, StepState } from '../run-state';
import { recordedToolReceipt } from './tool-receipt';

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

/** True when the person's own words in the chat ask for post copy to be written (English only). */
export function asksForPostCaption(request: string): boolean {
  return request
    .split(/\b(?:and|then|also)\b|[.!?;]/iu)
    .some((clause) => POST_CAPTION.test(clause) && WRITE_COPY.test(clause) && !SUBTITLE_CONTROL.test(clause));
}

/** The caption the run's message asked for in the caption panel, when this step edits the timeline it was asked on. */
function owedCaption(state: RunState, input: Record<string, unknown>): PostCaptionRequest | undefined {
  const brief = state.started?.editor;
  return brief?.postCaption && brief.context.timelineId === input.timelineId ? brief.postCaption : undefined;
}

/** The captions this run saved for the step's timeline (completed timeline.setPostCaption calls), oldest first. */
async function savedInRun(
  state: RunState,
  input: Record<string, unknown>,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<PostCaptionResult[]> {
  const saved: PostCaptionResult[] = [];
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    const requested = record(call?.requested.input);
    if (
      !call ||
      call.requested.tool !== POST_CAPTION_COMMAND ||
      call.outcome?.kind !== 'completed' ||
      requested?.projectId !== input.projectId ||
      requested?.timelineId !== input.timelineId
    )
      continue;
    const receipt = postCaptionResultSchema.safeParse(await recordedToolReceipt(call, artifacts));
    if (receipt.success && receipt.data.timelineId === input.timelineId) saved.push(receipt.data);
  }
  return saved;
}

const UNSAVED =
  ' If the caption cannot be written, explain that visibly and repeat the explanation verbatim in ' +
  'handOff.notSavedPostCaptionReason.';

/** A post caption asked for is delivered by the tool that holds it to its platform's rule, and shown to the person. */
export async function postCaptionHandoffProblem(
  state: RunState,
  step: StepState,
  handoff: unknown,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<string | undefined> {
  const input = record(step.entered?.input ?? step.input);
  if (step.skill !== 'timeline.editor' || !input) return undefined;
  const owed = owedCaption(state, input);
  const saved = await savedInRun(state, input, artifacts);
  const delivered = owed ? saved.filter((caption) => caption.platform === owed.platform) : saved;
  const asked =
    owed !== undefined || (typeof input.request === 'string' && asksForPostCaption(input.request));
  if (!asked && delivered.length === 0) return undefined;
  const visible = normalized(state.lastTurn?.text ?? '');
  if (delivered.length === 0) {
    const output = record(handoff);
    const reason =
      typeof output?.notSavedPostCaptionReason === 'string'
        ? normalized(output.notSavedPostCaptionReason)
        : '';
    if (reason && visible.includes(reason)) return undefined;
    if (owed)
      return (
        `The user asked for this ${postCaptionRule(owed.platform).name} caption in the editor's caption ` +
        `panel, so the step owes a caption saved for ${owed.platform}. None was saved in this run. Read what ` +
        `the video shows with timeline.get, then save the caption's parts with timeline.setPostCaption and ` +
        `platform "${owed.platform}"; when it refuses, it says what to fix.${UNSAVED}`
      );
    return (
      'The person asked for a social post caption, not subtitles. Save its parts with timeline.setPostCaption ' +
      'and show the text it answers in your visible response. Changing subtitle settings or saying that the ' +
      'caption is done does not deliver it. Preserve subtitle settings unless the person separately asked to ' +
      `change them.${UNSAVED}`
    );
  }
  // The panel shows what was saved. From the chat, the person reads the answer: the saved text is in it.
  if (owed) return undefined;
  const latest = delivered.at(-1);
  if (latest && visible.includes(normalized(latest.text))) return undefined;
  return (
    'The caption is saved, but the person reads it in this chat: put the text timeline.setPostCaption ' +
    'answered in your visible response, exactly as written, then hand off again.'
  );
}
