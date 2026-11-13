// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): the vision judge. A design is drawn over the reel's own frame from just before its graphic came on,
 * at the moments the reel shows it entering and held, and a vision model compares each with the reel's frame at the
 * same moment: the graphic's place on the frame, its size against the frame, its line count, its shape and colours,
 * and how far on it is while entering. It answers whether they match and, when not, what differs in words the
 * Designer can act on. Its answer is untrusted model output: parsed, bounded, and only ever shown as text.
 */
import { z } from 'zod';
import { err, ValidationError, type AsyncResult } from '@taalcut/core';
import type { OverlayBrief } from './brief';
import type { DesignPicture } from './designer';

export type JudgeContent =
  { readonly type: 'text'; readonly text: string } | ({ readonly type: 'image' } & DesignPicture);

/** One call to a model that sees pictures (the app's: the chat's model when it does). */
export interface JudgeModel {
  complete(
    request: {
      readonly system: string;
      readonly messages: readonly { readonly role: 'user'; readonly content: readonly JudgeContent[] }[];
      readonly maxTokens: number;
    },
    signal?: AbortSignal,
  ): AsyncResult<{ readonly text: string; readonly provider: string; readonly model: string }>;
}

/** The reel's frame and the design's at one moment. */
export interface JudgedPair {
  /** "entering, 2 frames in", "held". */
  readonly moment: string;
  readonly reel: DesignPicture;
  readonly design: DesignPicture;
}

export interface ReelVerdict {
  readonly matches: boolean;
  /** At most six, in plain words; empty when it matches. Untrusted. */
  readonly differences: readonly string[];
  /** `provider/model` that judged. */
  readonly by: string;
}

/** Compares a design's frames with the reel's. Never throws. */
export type JudgeReel = (
  input: { readonly brief: OverlayBrief; readonly pairs: readonly JudgedPair[] },
  signal?: AbortSignal,
) => AsyncResult<ReelVerdict>;

export const JUDGE_SYSTEM_PROMPT = [
  "You check a motion designer's copy of one graphic from a reel (a short vertical video).",
  'For each moment you get two pictures: the reel as it is, then the copy drawn over the same shot from just before the graphic came on.',
  "Judge only that graphic, as a viewer would see it: where it sits on the frame, its size against the frame, how many lines its words take, its shape, colours, corners and tail, its type's weight, and while it is entering, how far on it is.",
  'The words may differ; ignore what they say. Ignore everything else in the picture.',
  'Answer with JSON only: {"matches": true|false, "differences": ["..."]}.',
  'Give at most six differences, each short and actionable with its direction and size, for example "sits about 40 px too low", "two lines where the reel has one", "the tail is on the wrong side". Say "matches": true only when a viewer would take them for the same design.',
].join('\n');

const verdictSchema = z.object({
  matches: z.boolean(),
  differences: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
});

/** The first JSON object in a model's answer, as a verdict; null when there is none. */
export function parseVerdict(text: string): z.output<typeof verdictSchema> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = verdictSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The judge over a model that sees pictures. */
export function visionJudge(model: JudgeModel): JudgeReel {
  return async ({ brief, pairs }, signal) => {
    const content: JudgeContent[] = [
      {
        type: 'text',
        text:
          `The graphic: the reel's ${brief.role}, hanging from the ${brief.place.side}, ` +
          `${brief.lines} line${brief.lines === 1 ? '' : 's'} in the reel.`,
      },
    ];
    for (const pair of pairs) {
      content.push({ type: 'text', text: `${pair.moment}: the reel, then the copy.` });
      content.push({ type: 'image', ...pair.reel }, { type: 'image', ...pair.design });
    }
    const answer = await model.complete(
      { system: JUDGE_SYSTEM_PROMPT, messages: [{ role: 'user', content }], maxTokens: 400 },
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
