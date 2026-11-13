// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * GSAP's own eases, in Node (SPEC G.4): where compile code needs an ease's value at a frame (a counter's or a
 * chart's pre-formatted steps), it asks the same package the page runs, so a step lands where the page's motion
 * is. A CSS cubic-bezier goes through CustomEase, as tc.js does.
 */
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CUBIC_BEZIER, EASE_PATTERN, EASES } from './motion-data';

gsap.registerPlugin(CustomEase);

const NAMED: ReadonlySet<string> = new Set(EASES);
const cache = new Map<string, (progress: number) => number>();

/** The ease function for a tween's `ease` (absent is linear); throws on an ease tc.js would refuse. */
export function easeFunction(ease: string | undefined): (progress: number) => number {
  const name = ease ?? 'none';
  const known = cache.get(name);
  if (known) return known;
  let made: (progress: number) => number;
  const bezier = CUBIC_BEZIER.exec(name);
  if (bezier) made = CustomEase.create(`tc-${cache.size}`, bezier.slice(1, 5).join(','));
  else if (NAMED.has(name) || EASE_PATTERN.test(name)) made = gsap.parseEase(name);
  else throw new Error(`Unknown ease '${name}'`);
  cache.set(name, made);
  return made;
}
