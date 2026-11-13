// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A scripted clip's plan (IX3-D1): its shots and transitions as written, so fades through black and the things
 * that look like them sit exactly where the labels say. The set's seed only gives each look its parameters (and
 * the bed's), as plan.ts does. Labels, as the shot eval reads them:
 * - a hard cut: where the new shot starts;
 * - a dissolve: from where the new shot starts, for its length;
 * - a fade through black: from the fade out's first frame (the black's first, when the shot before cuts to it)
 *   for the fade out, the black and the fade in;
 * - a cut to black and back (a fade with no fade out and no fade in): two cuts, where the black starts and where
 *   the next shot starts.
 */
import { round, type ClipPlan, type CutMark, type ShotPlan } from './plan-shape';
import { clipSeed, seeded } from './random';
import type { ClipSpec, FootageSet, ScriptedEntry, ScriptedShot } from './sets/types';

function marks(end: number, startsAt: number, entry: ScriptedEntry | undefined): CutMark[] {
  if (entry === undefined || entry.kind === 'cut') return [{ at: startsAt, kind: 'cut', seconds: 0 }];
  if (entry.kind === 'dissolve') return [{ at: startsAt, kind: 'dissolve', seconds: entry.seconds }];
  if (entry.out === 0 && entry.in === 0)
    return [
      { at: end, kind: 'cut', seconds: 0 },
      { at: startsAt, kind: 'cut', seconds: 0 },
    ];
  return [{ at: round(end - entry.out), kind: 'fade', seconds: round(entry.out + entry.hold + entry.in) }];
}

/** A transition that can't be drawn: longer than the shots it joins, or a fade with nothing in it. */
function checkEntry(file: string, entry: ScriptedEntry, before: ScriptedShot, shot: ScriptedShot): void {
  const fits = (seconds: number, inside: number) => seconds >= 0 && seconds <= inside;
  const ok =
    entry.kind === 'cut' ||
    (entry.kind === 'dissolve' &&
      entry.seconds > 0 &&
      fits(entry.seconds, before.seconds) &&
      fits(entry.seconds, shot.seconds)) ||
    (entry.kind === 'fade' &&
      fits(entry.out, before.seconds) &&
      fits(entry.in, shot.seconds) &&
      entry.hold >= 0 &&
      entry.out + entry.hold + entry.in > 0);
  if (!ok) throw new Error(`${file}: the ${entry.kind} into a ${shot.look} shot doesn't fit its shots`);
}

export function scriptedPlan(set: FootageSet, clip: ClipSpec, script: readonly ScriptedShot[]): ClipPlan {
  const random = seeded(clipSeed(set.seed, clip.file));
  const shots: ShotPlan[] = [];
  const cuts: CutMark[] = [];
  let end = 0;
  script.forEach((scripted, index) => {
    const before = script[index - 1];
    const entry = before === undefined ? undefined : scripted.entry;
    if (entry !== undefined && before !== undefined) checkEntry(clip.file, entry, before, scripted);
    const dissolve = entry?.kind === 'dissolve' ? entry.seconds : 0;
    const fade = entry?.kind === 'fade' ? { out: entry.out, hold: entry.hold, in: entry.in } : undefined;
    const startsAt = round(end - dissolve + (fade?.hold ?? 0));
    if (index > 0) cuts.push(...marks(end, startsAt, entry));
    shots.push({
      look: scripted.look,
      seconds: scripted.seconds,
      dissolve,
      ...(fade ? { fade } : {}),
      ...(scripted.dark === true ? { dark: true } : {}),
      startsAt,
      seed: random.int(1, 2_000_000_000),
      text: null,
    });
    end = round(startsAt + scripted.seconds);
  });
  return {
    clip,
    shots,
    cuts,
    texts: [],
    music:
      clip.bed === 'music'
        ? { bpm: random.int(96, 128), rootHz: random.pick([196, 220, 246.94, 261.63]) }
        : null,
    noiseSeed: random.int(1, 2_000_000_000),
  };
}
