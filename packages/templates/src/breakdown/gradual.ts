// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gradual transitions, found from pixels (MATCH1, SPEC "Gradual transitions"). The two cut methods see a change of
 * picture: scdet a jump between neighbouring frames, the embeddings a jump over a quarter of a second. A dissolve
 * that takes a third of a second between two pictures that look alike (a match dissolve: a hand here, a hand there)
 * gives neither a jump, and the reel's main moment is lost in the middle of a "shot". No model is asked: a blend of
 * two pictures is arithmetic, and it can be measured (gradual-ramp.ts).
 *
 * - A **dissolve** is a ramp out of one steady picture, into another steady picture, or both: the frames are read
 *   forwards and backwards, since often only one side holds still. A reading is generous about the end of the ramp
 *   beside the picture it measures from (that picture's own movement reads as the first of the blend) and can be
 *   short about the far end when its picture moves. So where both see it their spans are joined: a frame either
 *   reading calls blended is blended, which may take in a clean frame or two and never leaves a blended one out.
 * - A **fade** through black or white is a ramp out of a picture into frames with none, and, within
 *   `maxHoldSeconds`, a ramp out of those into a picture. One half alone (a reel that fades in, or out) is not a
 *   transition between shots and is left to the other steps (one-shot.ts's fade tail).
 *
 * What comes back is where the transition starts and ends and where the new shot begins inside it: the first frame
 * holding more of the new picture than the old (a fade: the first frame after its black). `withGradual` puts each
 * into the cut findings in place of whatever the other methods proposed inside it. Pure.
 */
import type { BreakdownConfig } from './config';
import type { CutFinding } from './cut-merge';
import { grayScan, rampsIn, reversed, type GradualConfig, type Ramp } from './gradual-ramp';

export interface GradualTransition {
  readonly kind: 'dissolve' | 'fade';
  /** The first and the last frame that are not wholly one shot's own picture. */
  readonly start: number;
  readonly end: number;
  /** The new shot's first frame, inside the transition: `start` < `frame` ≤ `end`. */
  readonly frame: number;
  /** Both readings saw it (a fade always has both of its halves). */
  readonly bothSides: boolean;
}

/** A ramp seen forwards (`out` of the picture before) or backwards (`into` the picture after), in reel frames. */
interface Sided {
  /** The last frame wholly the old picture (or, into a picture, wholly without one), and the first wholly the new. */
  readonly from: number;
  readonly to: number;
  readonly half: number;
  /** The end away from the reference has no picture. */
  readonly empty: boolean;
}

function mirrored(ramp: Ramp, count: number): Sided {
  const last = count - 1;
  // Backwards, `half` is the first frame holding more of the old picture: the new shot starts the frame after it.
  return { from: last - ramp.to, to: last - ramp.from, half: last - ramp.half + 1, empty: ramp.empty };
}

const overlap = (a: Sided, b: Sided) => a.from < b.to && b.from < a.to;

/** Every dissolve and fade between shots, in order. `fps` is the frames' rate. */
export function findGradual(
  frames: readonly Uint8Array[],
  fps: number,
  config: GradualConfig,
): GradualTransition[] {
  if (frames.length < config.steadyFrames + config.minBlended + config.plateau + 1) return [];
  const reach = Math.max(config.minBlended + 2, Math.round(config.maxSeconds * fps));
  const scan = grayScan(frames);
  const out: Sided[] = rampsIn(scan, reach, config);
  const into = rampsIn(reversed(scan), reach, config).map((ramp) => mirrored(ramp, frames.length));
  const flat = (frame: number) => scan.stats[frame]!.deviation < config.detail;
  const found: GradualTransition[] = [];
  const clamp = (frame: number, start: number, end: number) => Math.min(end, Math.max(start + 1, frame));

  // Fades: out of a picture into none, the black held, then out of it into a picture.
  const hold = Math.round(config.maxHoldSeconds * fps);
  const usedInto = new Set<Sided>();
  for (const fadeOut of out.filter((ramp) => ramp.empty)) {
    const fadeIn = into.find(
      (ramp) =>
        ramp.empty && !usedInto.has(ramp) && ramp.from >= fadeOut.to - 1 && ramp.from - fadeOut.to <= hold,
    );
    if (!fadeIn) continue;
    let held = true;
    for (let frame = fadeOut.to; frame <= fadeIn.from; frame++) held &&= flat(frame);
    if (!held) continue;
    usedInto.add(fadeIn);
    const start = fadeOut.from + 1;
    const end = fadeIn.to - 1;
    found.push({ kind: 'fade', start, end, frame: clamp(fadeIn.from + 1, start, end), bothSides: true });
  }

  // Dissolves: picture to picture; the two readings of one are joined.
  const dissolvesInto = into.filter((ramp) => !ramp.empty);
  const joined = new Set<Sided>();
  for (const ramp of out.filter((item) => !item.empty)) {
    const partner = dissolvesInto.find((item) => !joined.has(item) && overlap(ramp, item));
    if (partner) joined.add(partner);
    const start = Math.min(ramp.from, partner?.from ?? ramp.from) + 1;
    const end = Math.max(ramp.to, partner?.to ?? ramp.to) - 1;
    const half = partner ? Math.round((ramp.half + partner.half) / 2) : ramp.half;
    found.push({ kind: 'dissolve', start, end, frame: clamp(half, start, end), bothSides: Boolean(partner) });
  }
  for (const ramp of dissolvesInto.filter((item) => !joined.has(item))) {
    const start = ramp.from + 1;
    const end = ramp.to - 1;
    found.push({ kind: 'dissolve', start, end, frame: clamp(ramp.half, start, end), bothSides: false });
  }

  // One span, one transition: of two that overlap, the fade (it has both halves), else the earlier.
  const sorted = found.sort((a, b) => a.start - b.start || (a.kind === 'fade' ? -1 : 1));
  const kept: GradualTransition[] = [];
  for (const item of sorted) {
    const last = kept[kept.length - 1];
    if (!last || item.start > last.end) kept.push(item);
    else if (item.kind === 'fade' && last.kind !== 'fade') kept[kept.length - 1] = item;
  }
  return kept;
}

/** How sure a transition found from pixels is: both readings, or one. */
const CONFIDENCE = { both: 0.95, one: 0.8 } as const;

/**
 * The findings with each gradual transition in them. Whatever the cut methods proposed inside a transition (a scene
 * score at its steepest frame, a soft cut somewhere in its ramp) is the transition itself, and goes. `distance` is
 * method B's word on the two pictures (the frames just before against the frames just after, null when not
 * embedded): far apart, two methods agree and the cut is confirmed; otherwise it is disputed and the rule keeps it,
 * unless the two sides look the same to method B (a dip inside one shot).
 */
export function withGradual(
  findings: readonly CutFinding[],
  transitions: readonly GradualTransition[],
  distance: (transition: GradualTransition) => number | null,
  config: Pick<BreakdownConfig, 'embed'>,
): CutFinding[] {
  const inside = (finding: CutFinding, transition: GradualTransition) =>
    (finding.frame >= transition.start - 1 && finding.frame <= transition.end + 1) ||
    (finding.ramp !== null && finding.ramp.start <= transition.end && finding.ramp.end >= transition.start);
  const kept = findings.filter((finding) => !transitions.some((transition) => inside(finding, transition)));
  const added = transitions.map((transition): CutFinding => {
    const apart = distance(transition);
    const confirmed = apart !== null && apart >= config.embed.confirm;
    return {
      frame: transition.frame,
      method: confirmed ? 'both' : 'pixels',
      status: confirmed ? 'confirmed' : 'disputed',
      score: null,
      distance: apart,
      ramp: { start: transition.start, end: transition.end },
      ruleKeeps: apart === null || apart >= config.embed.reject,
      blend: {
        kind: transition.kind,
        before: transition.frame - transition.start,
        after: transition.end - transition.frame + 1,
        confidence: transition.bothSides ? CONFIDENCE.both : CONFIDENCE.one,
      },
    };
  });
  return [...kept, ...added].sort((a, b) => a.frame - b.frame);
}
