// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's plan, from its spec and the set's seed alone: the shots (a moving look each, 3–9 s), how each one
 * begins (a hard cut, or a dissolve of 0.5 or 1 s about one time in four), where the on-screen lines show,
 * which shot is colour bars, and the music's tempo and key. Times are known before anything is encoded, so the
 * manifest can say where every cut is. A clip with a script (IX3-D1) is planned from it instead
 * (plan-script.ts): its shots, transitions and fades through black as written, the seed giving only each look's
 * parameters.
 */
import { LOOKS, type Look } from './look-names';
import { round, type ClipPlan, type CutMark, type ShotPlan } from './plan-shape';
import { scriptedPlan } from './plan-script';
import { clipSeed, seeded, type Random } from './random';
import type { ClipSpec, FootageSet } from './sets/types';

export { LOOKS, type Look } from './look-names';
export type { ClipPlan, CutMark, ShotPlan } from './plan-shape';

const MIN_SHOT = 3;
const MAX_SHOT = 9;

function lengths(total: number, random: Random): { seconds: number; dissolve: number }[] {
  const shots: { seconds: number; dissolve: number }[] = [];
  let covered = 0;
  for (;;) {
    const dissolve = shots.length === 0 || random.next() >= 0.25 ? 0 : random.pick([0.5, 1]);
    const left = total - covered + dissolve;
    if (left <= MAX_SHOT + MIN_SHOT) {
      // The rest in one shot, or two when one would be too long.
      if (left <= MAX_SHOT) shots.push({ seconds: round(left), dissolve });
      else {
        const first = round(left / 2);
        shots.push({ seconds: first, dissolve }, { seconds: round(left - first), dissolve: 0 });
      }
      return shots;
    }
    const seconds = random.between(MIN_SHOT, MAX_SHOT, 1);
    shots.push({ seconds, dissolve });
    covered += seconds - dissolve;
  }
}

function looks(count: number, bars: boolean, random: Random): Look[] {
  const chosen: Look[] = [];
  for (let index = 0; index < count; index += 1) {
    const previous = chosen[index - 1];
    chosen.push(random.pick(LOOKS.filter((look) => look !== previous)));
  }
  // Bars replace one shot in the middle third, so the clip's first picture (its thumbnail) is never bars.
  const third = Math.floor(count / 3);
  if (bars && count > 0) chosen[Math.min(count - 1, third + random.int(0, Math.max(0, third - 1)))] = 'bars';
  return chosen;
}

export function planClip(set: FootageSet, clip: ClipSpec): ClipPlan {
  if (clip.script !== undefined) return scriptedPlan(set, clip, clip.script);
  const random = seeded(clipSeed(set.seed, clip.file));
  const sized = lengths(clip.seconds, random);
  const kinds = looks(sized.length, clip.bars, random);
  const textSlots = new Map<number, string>();
  const candidates = kinds.map((look, index) => ({ look, index })).filter(({ look }) => look !== 'bars');
  clip.onScreen.forEach((line, n) => {
    const slot = candidates[Math.floor(((n + 0.5) * candidates.length) / clip.onScreen.length)];
    if (slot !== undefined) textSlots.set(slot.index, line);
  });
  const shots: ShotPlan[] = [];
  const cuts: CutMark[] = [];
  let length = 0;
  sized.forEach(({ seconds, dissolve }, index) => {
    const startsAt = round(length - dissolve);
    if (index > 0) cuts.push({ at: startsAt, kind: dissolve > 0 ? 'dissolve' : 'cut', seconds: dissolve });
    const line = textSlots.get(index);
    const from = Math.min(seconds - 1, Math.max(0.5, dissolve));
    shots.push({
      look: kinds[index] ?? 'pattern',
      seconds,
      dissolve,
      startsAt,
      seed: random.int(1, 2_000_000_000),
      text: line === undefined ? null : { line, from, to: Math.min(seconds, from + 3) },
    });
    length = round(startsAt + seconds);
  });
  return {
    clip,
    shots,
    cuts,
    texts: shots.flatMap((shot) =>
      shot.text === null
        ? []
        : [
            {
              line: shot.text.line,
              from: round(shot.startsAt + shot.text.from),
              to: round(shot.startsAt + shot.text.to),
            },
          ],
    ),
    music:
      clip.bed === 'music'
        ? { bpm: random.int(96, 128), rootHz: random.pick([196, 220, 246.94, 261.63]) }
        : null,
    noiseSeed: random.int(1, 2_000_000_000),
  };
}

/** The clip's length as planned: the sum of its shots less their dissolves, with any black held between them. */
export const plannedSeconds = (plan: Pick<ClipPlan, 'shots'>): number =>
  round(plan.shots.reduce((sum, shot) => sum + shot.seconds - shot.dissolve + (shot.fade?.hold ?? 0), 0));
