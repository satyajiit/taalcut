// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tie-break for text the evidence left unsure (FIX-SIGN): after the breakdown job, off its path, the on-device
 * vision model (the strip describer, never a cloud one) is shown the frame round the words with the words outlined
 * (text-judge.ts saved it) and asked one question: printed in the scene, or added in editing? "Scene" drops the
 * overlay; "added" clears its doubt; anything else leaves the doubt for the review. Answers are kept beside the draft
 * (`text-checks.json`), so the same reel again asks nothing, and the draft's own records say what was asked.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { BreakdownDraft } from './draft';
import type { DescribeStrip } from './looks';

export const TEXT_CHECKS_FILE = 'text-checks.json';

/** At most this many readings are asked about per reel: the rest keep their doubt for the review. */
export const MAX_TEXT_CHECKS = 6;

/** Asked of the model with the words outlined in red. The words themselves are never in the question. */
export const TEXT_CHECK_QUESTION =
  'This is part of one frame of a video. The red box marks some words. Are those words printed on something in the ' +
  'filmed scene, such as a sign, a shop front, a screen, clothing or packaging? Or were they added on top of the ' +
  'video in editing, such as a title, a caption, a chat bubble, a label or a sticker? Answer with one word: scene ' +
  'or added.';

type Answer = 'scene' | 'composited' | 'unsure';
const answersSchema = z.record(z.string().max(64), z.enum(['scene', 'composited', 'unsure']));

/** The model's words as an answer: one of the two words alone, or unsure. */
export function answerOf(words: string): Answer {
  const said = words.toLowerCase();
  const scene = /\bscene\b/.test(said);
  const added = /\badded\b/.test(said);
  return scene === added ? 'unsure' : scene ? 'scene' : 'composited';
}

async function readAnswers(dir: string): Promise<Record<string, Answer>> {
  try {
    const parsed = answersSchema.safeParse(JSON.parse(await readFile(join(dir, TEXT_CHECKS_FILE), 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function writeAtomically(path: string, data: string): Promise<boolean> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
    return true;
  } catch {
    return false;
  }
}

/** The draft with the answers applied: scene drops the overlay, added clears its doubt. */
export function withAnswers(
  draft: BreakdownDraft,
  answers: Readonly<Record<string, Answer>>,
): BreakdownDraft {
  const text = draft.text.flatMap((overlay) => {
    const answer = answers[overlay.id];
    if (answer === 'scene') return [];
    if (answer !== 'composited' || !overlay.doubts) return [overlay];
    const doubts = overlay.doubts.filter((doubt) => doubt.reason !== 'textMaybeScene');
    const { doubts: _, ...rest } = overlay;
    return [doubts.length > 0 ? { ...rest, doubts } : rest];
  });
  const textRegions = draft.textRegions?.map((region) => {
    const answer = region.overlayId ? answers[region.overlayId] : undefined;
    if (!answer) return region;
    return { ...region, asked: answer, overlayId: answer === 'scene' ? null : region.overlayId };
  });
  return { ...draft, text, ...(textRegions ? { textRegions } : {}) };
}

/**
 * Asks about each unsure reading with a saved frame and no answer yet, at most MAX_TEXT_CHECKS, one at a time, and
 * returns the draft with every answer applied. A failed or cancelled call asks nothing more.
 */
export async function checkSceneText(
  draft: BreakdownDraft,
  dir: string,
  describe: DescribeStrip,
  options: { readonly signal: AbortSignal },
): Promise<{ draft: BreakdownDraft; asked: number }> {
  const answers = await readAnswers(dir);
  const kept = new Set<string>(draft.text.map((overlay) => overlay.id));
  const todo = (draft.textRegions ?? [])
    .filter(
      (region) =>
        region.kind === 'unsure' &&
        region.crop !== undefined &&
        region.overlayId !== null &&
        kept.has(region.overlayId) &&
        answers[region.overlayId] === undefined,
    )
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, MAX_TEXT_CHECKS);
  let asked = 0;
  for (const region of todo) {
    if (options.signal.aborted) break;
    const said = await describe(join(dir, region.crop!), {
      signal: options.signal,
      question: TEXT_CHECK_QUESTION,
    });
    if (!said.ok) break;
    answers[region.overlayId!] = answerOf(said.value);
    asked++;
  }
  if (asked > 0) await writeAtomically(join(dir, TEXT_CHECKS_FILE), JSON.stringify(answers));
  return { draft: Object.keys(answers).length > 0 ? withAnswers(draft, answers) : draft, asked };
}
