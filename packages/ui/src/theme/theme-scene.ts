// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V5
 * Hallmark · motion: the day/night scene · genre: atmospheric studio app · system: DESIGN.md v0.3 (Theme engine)
 * Nightfall (to dark): the sun lifts out of the control you clicked and sets along an arc below the bottom edge,
 *   dusk washes down the window with a soft horizon, the crescent moon rises top right in a faint violet halo
 *   and three stars twinkle once. Daybreak (to light): the moon slips away, the sun rises from the bottom edge
 *   in a marigold glow as light washes up, its rays turn a few degrees and it fades.
 * 840 ms on --ease-in-out. The bodies are their own view-transition layers, moved by transform and opacity
 *   only; the wash is the new picture's mask. Plays only for a switch you make with a control; ⌘K and the
 *   menu crossfade, the Mac's appearance changes at once, reduced motion is a 150 ms crossfade.
 */
import { bezierAt, EASE_IN_OUT } from '#lib/motion';
import moonUrl from './art/moon.webp';
import starUrl1 from './art/star-1.webp';
import starUrl2 from './art/star-2.webp';
import starUrl3 from './art/star-3.webp';
import sunUrl from './art/sun.webp';

/* eslint-disable lingui/no-unlocalized-strings -- CSS values and view-transition names, not text */

export type SceneKind = 'nightfall' | 'daybreak';

/** A place in the window, px from its top left (where a switch was made). */
export interface Point {
  x: number;
  y: number;
}

/** The scene's length, ms (twice --dur-long). */
export const SCENE_MS = 840;

/** The bodies' view-transition-class: styles.css keeps the browser's own fades off them. */
export const SCENE_CLASS = 'tc-scene';

/** The share of the scene the wash takes, and when it starts (fractions of SCENE_MS). */
const WASH = { nightfall: { start: 0, length: 0.78 }, daybreak: { start: 0, length: 0.78 } } as const;
/** The horizon's soft band, as a share of the window's height (styles.css draws the mask to match). */
const SOFT = 0.25;

const ART = [sunUrl, moonUrl, starUrl1, starUrl2, starUrl3];
const SIZE = { sun: 96, sunGlow: 280, moon: 88, halo: 300 } as const;
const STARS = [
  { url: starUrl1, size: 28, at: [-0.22, 0.03] },
  { url: starUrl2, size: 20, at: [-0.1, 0.18] },
  { url: starUrl3, size: 24, at: [0.06, 0.22] },
] as const;

const ease = (t: number) => bezierAt(EASE_IN_OUT, t);

/** Inverse of the in-out ease: the time (0–1) at which it reaches `value`. */
function easeTimeOf(value: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (ease(mid) < value) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Where the horizon's middle is (px from the top) as the wash goes, p from 0 to 1. */
function horizonAt(kind: SceneKind, p: number, height: number): number {
  const travel = height * (1 + SOFT);
  const startY = kind === 'nightfall' ? -height * (SOFT / 2) : height * (1 + SOFT / 2);
  return kind === 'nightfall' ? startY + travel * p : startY - travel * p;
}

/**
 * ms from the scene's start until its horizon crosses `y` (a control in the
 * window): the toggle's own icon turns from sun to moon (or back) as the wash
 * reaches it, so it starts its morph half a morph before.
 */
export function horizonReaches(kind: SceneKind, y: number, height = window.innerHeight): number {
  const { start, length } = WASH[kind];
  const travel = height * (1 + SOFT);
  const startY = horizonAt(kind, 0, height);
  const p = Math.min(1, Math.max(0, Math.abs(y - startY) / travel));
  return Math.round((start + length * easeTimeOf(p)) * SCENE_MS);
}

/** Keyframes for the new picture's mask, from hidden to shown (styles.css sets the mask's image and size). */
export function washKeyframes(kind: SceneKind): Keyframe[] {
  // The mask is three windows tall, its soft band in the middle: it slides one window and a band.
  const from = kind === 'nightfall' ? -(1.5 + SOFT / 2) : -(0.5 - SOFT / 2);
  const to = kind === 'nightfall' ? -(0.5 - SOFT / 2) : -(1.5 + SOFT / 2);
  return [{ maskPosition: `0 ${from * 100}vh` }, { maskPosition: `0 ${to * 100}vh` }];
}

export function washTiming(kind: SceneKind): KeyframeAnimationOptions {
  const { start, length } = WASH[kind];
  return {
    delay: start * SCENE_MS,
    duration: length * SCENE_MS,
    easing: `cubic-bezier(${EASE_IN_OUT.join(', ')})`,
    fill: 'both',
  };
}

let preloaded = false;

/** Fetches and decodes the art, so the first scene has it ready (the toggle calls this on hover or focus). */
export function preloadScene(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const url of ART) {
    const image = new Image();
    image.src = url;
    // jsdom's Image has no decode. A missing method throws before .catch can run.
    if (typeof image.decode === 'function') void image.decode().catch(() => undefined);
  }
}

interface Part {
  readonly name: string;
  readonly el: HTMLElement;
  readonly frames: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
}

function part(name: string, el: HTMLElement, at: Point, size: number): HTMLElement {
  el.style.cssText += `position:fixed;left:${at.x - size / 2}px;top:${at.y - size / 2}px;width:${size}px;height:${size}px;view-transition-name:${name};view-transition-class:${SCENE_CLASS};pointer-events:none;`;
  el.dataset.scenePart = name;
  return el;
}

function image(url: string): HTMLImageElement {
  const el = document.createElement('img');
  el.src = url;
  el.alt = '';
  el.decoding = 'sync';
  return el;
}

function glow(colour: string): HTMLElement {
  const el = document.createElement('div');
  el.style.background = `radial-gradient(closest-side, color-mix(in oklch, var(${colour}) 70%, transparent), color-mix(in oklch, var(${colour}) 24%, transparent) 55%, transparent)`;
  return el;
}

const WHOLE: KeyframeAnimationOptions = { duration: SCENE_MS, fill: 'both' };
const move = (x: number, y: number, scale = 1, turn = 0) =>
  `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${turn.toFixed(1)}deg)`;

/** The sun's sunset: out of the control and along an arc below the bottom edge, sampled so it curves. */
function sunsetFrames(origin: Point, width: number, height: number, glowing: boolean): Keyframe[] {
  // Towards the middle of the window, whichever side the control is on.
  const side = origin.x > width / 2 ? -1 : 1;
  const end = { x: side * width * 0.36, y: height - origin.y + SIZE.sun };
  const control = { x: side * width * 0.18, y: -height * 0.6 };
  const frames: Keyframe[] = [];
  const steps = 14;
  const until = 0.8;
  for (let i = 0; i <= steps; i += 1) {
    const u = ease(i / steps);
    const x = 2 * (1 - u) * u * control.x + u * u * end.x;
    const y = 2 * (1 - u) * u * control.y + u * u * end.y;
    const grow = Math.min(1, (i / steps) * 2.6);
    const scale = glowing ? 0.4 + 0.6 * grow : 0.18 + 0.82 * grow;
    const opacity = Math.min(1, (i / steps) * 6) * (glowing ? 0.8 : 1);
    frames.push({ offset: (i / steps) * until, transform: move(x, y, scale, 12 * side * u), opacity });
  }
  frames.push({ offset: 1, transform: move(end.x, end.y, 1, 12 * side), opacity: 0 });
  return frames;
}

function nightfall(origin: Point, width: number, height: number): Part[] {
  const sky = { x: width - Math.max(120, width * 0.14), y: Math.max(84, height * 0.13) };
  const rise: Keyframe[] = [
    { offset: 0, transform: move(0, 56, 0.9), opacity: 0 },
    { offset: 0.28, transform: move(0, 56, 0.9), opacity: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { offset: 0.66, transform: move(0, 0), opacity: 1 },
    { offset: 0.86, transform: move(0, -4, 1, -4), opacity: 1 },
    { offset: 1, transform: move(0, -6, 1, -5), opacity: 0 },
  ];
  const parts: Part[] = [
    {
      name: 'tc-scene-glow',
      el: part('tc-scene-glow', glow('--color-marigold'), origin, SIZE.sunGlow),
      frames: sunsetFrames(origin, width, height, true),
      timing: WHOLE,
    },
    {
      name: 'tc-scene-sun',
      el: part('tc-scene-sun', image(sunUrl), origin, SIZE.sun),
      frames: sunsetFrames(origin, width, height, false),
      timing: WHOLE,
    },
    {
      name: 'tc-scene-halo',
      el: part('tc-scene-halo', glow('--color-violet'), sky, SIZE.halo),
      frames: rise.map((f) => ({ ...f, opacity: Number(f.opacity) * 0.55 })),
      timing: WHOLE,
    },
    { name: 'tc-scene-moon', el: part('tc-scene-moon', image(moonUrl), sky, SIZE.moon), frames: rise, timing: WHOLE },
  ];
  STARS.forEach((star, i) => {
    const at = { x: sky.x + star.at[0] * width, y: sky.y + star.at[1] * height };
    parts.push({
      name: `tc-scene-star-${i + 1}`,
      el: part(`tc-scene-star-${i + 1}`, image(star.url), at, star.size),
      frames: [
        { transform: move(0, 0, 0.2), opacity: 0 },
        { offset: 0.45, transform: move(0, 0, 1.15, 16), opacity: 1 },
        { transform: move(0, 0, 0.5, 32), opacity: 0 },
      ],
      timing: { delay: (0.4 + 0.1 * i) * SCENE_MS, duration: 0.36 * SCENE_MS, easing: 'ease-in-out', fill: 'both' },
    });
  });
  return parts;
}

function daybreak(origin: Point, width: number, height: number): Part[] {
  const sky = { x: width - Math.max(120, width * 0.14), y: Math.max(84, height * 0.13) };
  const dawn = { x: Math.min(width * 0.8, Math.max(width * 0.22, origin.x + width * 0.22)), y: height * 0.62 };
  const below = height - dawn.y + SIZE.sunGlow / 2;
  const rise = (peak: number): Keyframe[] => [
    { offset: 0, transform: move(0, below, 1, -16), opacity: peak },
    { offset: 0.06, transform: move(0, below, 1, -16), opacity: peak, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { offset: 0.6, transform: move(0, 0, 1, -4), opacity: peak },
    { offset: 0.78, transform: move(0, 0, 1, 0), opacity: peak, easing: 'ease-in' },
    { offset: 1, transform: move(0, -6, 1.06, 0), opacity: 0 },
  ];
  const slip: Keyframe[] = [
    { offset: 0, transform: move(0, 0), opacity: 0 },
    { offset: 0.06, transform: move(0, 0), opacity: 1, easing: 'cubic-bezier(0.32, 0, 0.67, 0)' },
    { offset: 0.42, transform: move(56, 92, 0.94, 20), opacity: 0 },
    { offset: 1, transform: move(56, 92, 0.94, 20), opacity: 0 },
  ];
  return [
    {
      name: 'tc-scene-halo',
      el: part('tc-scene-halo', glow('--color-violet'), sky, SIZE.halo),
      frames: slip.map((f) => ({ ...f, opacity: Number(f.opacity) * 0.5 })),
      timing: WHOLE,
    },
    { name: 'tc-scene-moon', el: part('tc-scene-moon', image(moonUrl), sky, SIZE.moon), frames: slip, timing: WHOLE },
    {
      name: 'tc-scene-glow',
      el: part('tc-scene-glow', glow('--color-marigold'), dawn, SIZE.sunGlow),
      frames: rise(0.9),
      timing: WHOLE,
    },
    { name: 'tc-scene-sun', el: part('tc-scene-sun', image(sunUrl), dawn, SIZE.sun), frames: rise(1), timing: WHOLE },
  ];
}

export interface Scene {
  /** Runs the bodies on their view-transition layers (call when the transition is ready). */
  play(root: HTMLElement): Animation[];
  /** Takes the scene's elements out of the page (when the transition has finished). */
  remove(): void;
}

let mounted: HTMLElement | null = null;

/**
 * Puts the scene's bodies in the page, each its own view-transition layer,
 * inside the transition's update (so the new picture has them and the old one
 * doesn't). They are in the page only while the transition shows them; once
 * their time is up they are hidden, then removed.
 */
export async function mountScene(kind: SceneKind, origin: Point): Promise<Scene> {
  mounted?.remove();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const parts = kind === 'nightfall' ? nightfall(origin, width, height) : daybreak(origin, width, height);
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.dataset.themeScene = kind;
  // Hidden from the scene's end on, in case the page draws a frame before it is removed.
  stage.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;animation:tc-scene-done 1ms step-end ${SCENE_MS}ms both;`;
  for (const p of parts) stage.append(p.el);
  document.body.append(stage);
  mounted = stage;
  // Decoded before the new picture is taken, so no body is captured blank.
  await Promise.all(
    [...stage.querySelectorAll('img')].map((img) =>
      typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined,
    ),
  );
  return {
    play: (root) =>
      parts.map((p) =>
        root.animate(p.frames, { ...p.timing, pseudoElement: `::view-transition-new(${p.name})` }),
      ),
    remove: () => {
      stage.remove();
      if (mounted === stage) mounted = null;
    },
  };
}

const sceneListeners = new Set<(kind: SceneKind) => void>();

/** Calls `listener` when a scene has played to its end (the mascot can doze after nightfall, grin after daybreak). */
export function onThemeScene(listener: (kind: SceneKind) => void): () => void {
  sceneListeners.add(listener);
  return () => sceneListeners.delete(listener);
}

export function sceneEnded(kind: SceneKind): void {
  for (const listener of sceneListeners) listener(kind);
}
