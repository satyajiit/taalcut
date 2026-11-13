// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: the vision judge for one slot, in the shape of HFW1's graphic judge (workspace/template/judge.ts). A
 * model that sees images gets, for each moment, the reel's frame and then the draft's, with what the slot is for in
 * words (its intent, needs and face, as the Analyst stated them), and answers whether a viewer would take the draft's
 * slot as doing the reel's job, and if not, what differs with its direction and size. The footage is the person's
 * own, so the scene differs by design: it judges the job, not the likeness of the place. Its answer is untrusted
 * model output: parsed, bounded and only ever shown as text. A text-only model reads match's checks instead.
 */
import { err, ValidationError, type AsyncResult } from '@taalcut/core';
import type { SlotFacts } from '@taalcut/timeline';
import type { DesignPicture } from '../workspace/template/designer';
import {
  parseVerdict,
  type JudgeContent,
  type JudgeModel,
  type ReelVerdict,
} from '../workspace/template/judge';

export interface SlotPair {
  /** "start", "middle", "end". */
  readonly moment: string;
  readonly reel: DesignPicture;
  readonly draft: DesignPicture;
}

/** Compares one slot's draft frames with the reel's. Never throws. */
export type JudgeSlot = (
  input: { readonly facts: SlotFacts; readonly pairs: readonly SlotPair[] },
  signal?: AbortSignal,
) => AsyncResult<ReelVerdict>;

export const SLOT_JUDGE_PROMPT = [
  'You check one slot of a short vertical video that copies the structure of a reel.',
  'For each moment you get two pictures: the reel’s frame, then the copy’s frame at the same point of the slot.',
  'The copy is made from the person’s own footage, so its place and people differ from the reel’s by design. Judge whether a viewer would take the copy’s slot as doing the reel’s job, as the slot’s words say it: what the shot shows and what it needs to show, whether the person’s face shows or is kept out, the shot size and where the subject sits and how big, the camera angle and how it moves between moments, light and colour, and the graphics or text on screen (where they sit and how big; ignore what the words say).',
  'Answer with JSON only: {"matches": true|false, "differences": ["..."]}.',
  'Give at most six differences, most important first, each short and actionable with its direction and size, for example "the subject sits about a third of the frame too far left", "a wide shot where the reel is a close-up", "the face shows where the slot keeps it out", "no graphic where the reel has one on the upper half". Say "matches": true only when the copy’s slot does the reel’s job.',
].join('\n');

/** The slot's words for the judge. */
function slotWords(facts: SlotFacts): string {
  const lines = [`Slot ${facts.slot} (${facts.role}): ${facts.intent}`];
  if (facts.needs.length > 0) lines.push(`It needs: ${facts.needs.join('; ')}.`);
  if (facts.face) lines.push(`The person’s face is ${facts.face} in the reel’s slot.`);
  const shot = [facts.shotType, facts.motion].filter(Boolean).join(', ');
  if (shot) lines.push(`Shot: ${shot}.`);
  return lines.join('\n');
}

/** The per-slot judge over a model that sees pictures. */
export function slotVisionJudge(model: JudgeModel): JudgeSlot {
  return async ({ facts, pairs }, signal) => {
    const content: JudgeContent[] = [{ type: 'text', text: slotWords(facts) }];
    for (const pair of pairs) {
      content.push({ type: 'text', text: `${pair.moment}: the reel, then the copy.` });
      content.push({ type: 'image', ...pair.reel }, { type: 'image', ...pair.draft });
    }
    const answer = await model.complete(
      { system: SLOT_JUDGE_PROMPT, messages: [{ role: 'user', content }], maxTokens: 400 },
      signal,
    );
    if (!answer.ok) return answer;
    const verdict = parseVerdict(answer.value.text);
    if (!verdict)
      return err(ValidationError({ field: 'verdict' }, { detail: 'The judge answered without its JSON' }));
    return {
      ok: true,
      value: {
        matches: verdict.matches,
        differences: verdict.matches ? [] : verdict.differences,
        by: `${answer.value.provider}/${answer.value.model}`,
      },
    };
  };
}
