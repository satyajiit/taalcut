// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1 looks: what each provisional slot's strip (its first and last frame) shows, described once by the pipeline
 * on this Mac, so every slot's picture reaches the Analyst whatever the model chooses to look at. The breakdown tool
 * describes the strips after the breakdown job; `templates.resolveCuts` puts each slot's description in its
 * context. A strip whose description failed has none, and the Analyst looks at it itself.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type AsyncResult } from '@taalcut/core';
import { describeFrame, type VisionDeps } from '@taalcut/vision';
import { z } from 'zod';
import { cameraWords, slotMeasure } from './camera';
import type { BreakdownDraft } from './draft';
import { LOOKS_CHARS, slotMoves } from './slot-context';

/** In the breakdown's experiment folder: strip path (relative to it) to its description. */
export const LOOKS_FILE = 'looks.json';

const STRIP =
  'This image is two moments of one shot of a video, its first and its last, side by side or one above the other. ';
/** FIX-CAST: what a person picks a clip by, so the Analyst can write an intent that fits anyone's footage. */
const PICKED_BY =
  ' Also say the light and time of day (day, night, golden hour, indoors), whether the subject faces the camera or away from it, and any visible on-screen text, title or chat bubbles (such as "with chat bubbles reading \'...\'" or "with title text").';
/** What the describer is asked about a strip the breakdown couldn't measure. */
export const STRIP_QUESTION =
  STRIP +
  'Say what the subject is and what it does, the place, the shot size, and how the camera moves from the first ' +
  'picture to the second (still, pan, tilt, push-in, pull-out, handheld, or tracking a subject).' +
  PICKED_BY;
/**
 * A strip of a slot that moves (BRK1 moves, measured): two pictures of a following camera look alike, so the
 * describer is told it moves rather than left to call it still.
 */
const MOVING_QUESTION =
  STRIP +
  'The camera moves during this shot (it was measured), even if the two pictures look alike. Say what the subject ' +
  'is and what it does, the place, the shot size, and how the camera moves: pan, tilt, push-in, pull-out, handheld, ' +
  'or tracking (following the subject).' +
  PICKED_BY;
const STILL_QUESTION =
  STRIP +
  'The picture barely moves during this shot (it was measured). Say what the subject is and what it does, the place ' +
  'and the shot size.' +
  PICKED_BY;

/** The question for a strip, from whether its slot moves (true, false, or null when unmeasured). */
export function stripQuestion(moves: boolean | null): string {
  return moves === null ? STRIP_QUESTION : moves ? MOVING_QUESTION : STILL_QUESTION;
}

/**
 * FRM1-MOT: the question for a strip whose camera move was measured (camera.ts `cameraWords`): the describer is told
 * the move as a fact, since two pictures can't show it; an unsure measure is not offered as one, and the describer
 * is asked not to guess.
 */
export function measuredQuestion(words: string): string {
  const said = words.startsWith('unsure:')
    ? 'How the camera moves could not be measured surely: do not guess it.'
    : `The camera's move during this shot was measured: ${words}. Take that as fact, even if the two pictures look alike.`;
  return `${STRIP}${said} Say what the subject is and what it does, the place and the shot size.${PICKED_BY}`;
}

/** Describes one strip image on this Mac; an error when it can't (no on-device vision model, a failed call). */
export type DescribeStrip = (
  path: string,
  options: { readonly signal: AbortSignal; readonly question: string },
) => AsyncResult<string>;

const looksSchema = z.record(z.string(), z.string().max(LOOKS_CHARS));

/** The descriptions saved for a breakdown; none when there is no file or it can't be read. */
export async function readLooks(dir: string): Promise<Record<string, string>> {
  try {
    const parsed = looksSchema.safeParse(JSON.parse(await readFile(join(dir, LOOKS_FILE), 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function writeLooks(dir: string, looks: Record<string, string>): Promise<boolean> {
  const temporary = join(dir, `${LOOKS_FILE}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(looks));
    await rename(temporary, join(dir, LOOKS_FILE));
    return true;
  } catch {
    return false;
  }
}

export interface DescribedStrips {
  readonly described: number;
  readonly failed: number;
}

/**
 * Describes every provisional slot's strip that has no saved description, one at a time (an on-device model does
 * one at a time anyway), saving after each, and reports progress over the strips. A failed strip is skipped; a
 * cancelled call stops.
 */
export async function describeStrips(
  draft: BreakdownDraft,
  dir: string,
  describe: DescribeStrip,
  options: { readonly signal: AbortSignal; readonly onProgress?: (fraction: number) => void },
): Promise<DescribedStrips> {
  const looks = await readLooks(dir);
  const todo = draft.slotFrames.filter((slot) => slot.strip !== undefined && looks[slot.strip] === undefined);
  let described = 0;
  let failed = 0;
  for (const [index, slot] of todo.entries()) {
    if (options.signal.aborted) break;
    options.onProgress?.(index / todo.length);
    const strip = slot.strip!;
    const words = cameraWords(slotMeasure(draft.camera, slot));
    const question = words ? measuredQuestion(words) : stripQuestion(slotMoves(draft, slot));
    const answer = await describe(join(dir, strip), { signal: options.signal, question });
    const text = answer.ok ? answer.value.trim().slice(0, LOOKS_CHARS) : '';
    if (text.length === 0) {
      failed += 1;
      continue;
    }
    looks[strip] = text;
    if (await writeLooks(dir, looks)) described += 1;
    else failed += 1;
  }
  options.onProgress?.(1);
  return { described, failed };
}

/** The strip describer over vision's: its on-device models only (never a cloud one), a quick low-detail look. */
export function stripDescriber(deps: VisionDeps): DescribeStrip {
  return async (path, { signal, question }) => {
    const answer = await describeFrame({ path, at: { value: 0, rate: 1 }, detail: 'low', question }, deps, {
      signal,
      placement: 'local',
    });
    // describeFrame answers an empty description with an error; a blank one counts as failed in describeStrips.
    return answer.ok ? ok(answer.value.description) : answer;
  };
}
