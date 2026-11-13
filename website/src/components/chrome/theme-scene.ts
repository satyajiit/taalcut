// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* motion: the day-and-night scene, ported from the app (packages/ui/src/theme/theme-scene.ts) · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2
 * Nightfall (to dark): the sun lifts out of the toggle and sets along an arc below the bottom edge as dusk washes down
 *   the page with a soft horizon; the crescent moon rises top right and three stars twinkle once. Daybreak (to
 *   light): the moon slips away and the sun rises from the bottom edge as light washes up, its rays turning a few
 *   degrees before it fades.
 * 840 ms on --ease-in-out. The bodies are their own view-transition layers, moved by transform and opacity only; the
 *   wash is the new picture's mask (theme-scene.css). The site leaves out the app's two glows (radial gradients):
 *   the bodies carry the scene alone. Reduced motion or no View Transitions: no scene (theme-transition.ts). */
import { EASE_IN_OUT } from '#lib/motion';

export type SceneKind = 'nightfall' | 'daybreak';

/** A place in the window, px from its top left (where the switch was made). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The scene's length, ms (twice --dur-long). */
export const SCENE_MS = 840;

/** The bodies' view-transition-class: theme-scene.css keeps the browser's own fades off them. */
export const SCENE_CLASS = 'tc-scene';

/** The share of the scene the wash takes. */
const WASH_LENGTH = 0.78;
/** The horizon's soft band, as a share of the window's height (theme-scene.css draws the mask to match). */
const SOFT = 0.25;

const ART = {
  sun: '/brand/theme/sun.webp',
  moon: '/brand/theme/moon.webp',
  stars: ['/brand/theme/star-1.webp', '/brand/theme/star-2.webp', '/brand/theme/star-3.webp'],
} as const;
const SIZE = { sun: 96, moon: 88 } as const;
const STARS = [
  { size: 28, at: [-0.22, 0.03] },
  { size: 20, at: [-0.1, 0.18] },
  { size: 24, at: [0.06, 0.22] },
] as const;

/** A CSS cubic-bezier's value at time t, the way browsers compute it (bisection on x). */
export function bezierAt([x1, y1, x2, y2]: readonly [number, number, number, number], t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const curve = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  let low = 0;
  let high = 1;
  let u = t;
  for (let i = 0; i < 24; i += 1) {
    u = (low + high) / 2;
    if (curve(x1, x2, u) < t) low = u;
    else high = u;
  }
  return curve(y1, y2, u);
}

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

/**
 * ms from the scene's start until its horizon crosses `y` (the toggle): the toggle's own icon turns from sun to moon
 * (or back) as the wash reaches it.
 */
export function horizonReaches(kind: SceneKind, y: number, height = window.innerHeight): number {
  const travel = height * (1 + SOFT);
  const startY = kind === 'nightfall' ? -height * (SOFT / 2) : height * (1 + SOFT / 2);
  const p = Math.min(1, Math.max(0, Math.abs(y - startY) / travel));
  return Math.round(WASH_LENGTH * easeTimeOf(p) * SCENE_MS);
}

/** Keyframes for the new picture's mask, from hidden to shown. */
export function washKeyframes(kind: SceneKind): Keyframe[] {
  // The mask is three windows tall, its soft band in the middle: it slides one window and a band.
  const from = kind === 'nightfall' ? -(1.5 + SOFT / 2) : -(0.5 - SOFT / 2);
  const to = kind === 'nightfall' ? -(0.5 - SOFT / 2) : -(1.5 + SOFT / 2);
  return [{ maskPosition: `0 ${from * 100}vh` }, { maskPosition: `0 ${to * 100}vh` }];
}

export const WASH_TIMING: KeyframeAnimationOptions = {
  duration: WASH_LENGTH * SCENE_MS,
  easing: `cubic-bezier(${EASE_IN_OUT.join(', ')})`,
  fill: 'both',
};

let preloaded = false;

/** Fetches and decodes the art, so the first scene has it ready (the toggle calls this on hover, focus or idle). */
export function preloadScene(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const url of [ART.sun, ART.moon, ...ART.stars]) {
    const img = new Image();
    img.src = url;
    if (typeof img.decode === 'function') void img.decode().catch(() => undefined);
  }
}

interface Part {
  readonly name: string;
  readonly el: HTMLElement;
  readonly frames: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
}

function body(name: string, url: string, at: Point, size: number): HTMLElement {
  const el = document.createElement('img');
  el.src = url;
  el.alt = '';
  el.decoding = 'sync';
  el.style.cssText = `position:fixed;left:${at.x - size / 2}px;top:${at.y - size / 2}px;width:${size}px;height:${size}px;view-transition-name:${name};view-transition-class:${SCENE_CLASS};pointer-events:none;`;
  el.dataset.scenePart = name;
  return el;
}

const WHOLE: KeyframeAnimationOptions = { duration: SCENE_MS, fill: 'both' };
const move = (x: number, y: number, scale = 1, turn = 0) =>
  `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${turn.toFixed(1)}deg)`;

/** The sun's sunset: out of the toggle and along an arc below the bottom edge, sampled so it curves. */
function sunsetFrames(origin: Point, width: number, height: number): Keyframe[] {
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
    const scale = 0.18 + 0.82 * Math.min(1, (i / steps) * 2.6);
    frames.push({ offset: (i / steps) * until, transform: move(x, y, scale, 12 * side * u), opacity: Math.min(1, (i / steps) * 6) });
  }
  frames.push({ offset: 1, transform: move(end.x, end.y, 1, 12 * side), opacity: 0 });
  return frames;
}

function skyOf(width: number, height: number): Point {
  return { x: width - Math.max(120, width * 0.14), y: Math.max(84, height * 0.13) };
}

function nightfall(origin: Point, width: number, height: number): Part[] {
  const sky = skyOf(width, height);
  const rise: Keyframe[] = [
    { offset: 0, transform: move(0, 56, 0.9), opacity: 0 },
    { offset: 0.28, transform: move(0, 56, 0.9), opacity: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { offset: 0.66, transform: move(0, 0), opacity: 1 },
    { offset: 0.86, transform: move(0, -4, 1, -4), opacity: 1 },
    { offset: 1, transform: move(0, -6, 1, -5), opacity: 0 },
  ];
  const parts: Part[] = [
    { name: 'tc-scene-sun', el: body('tc-scene-sun', ART.sun, origin, SIZE.sun), frames: sunsetFrames(origin, width, height), timing: WHOLE },
    { name: 'tc-scene-moon', el: body('tc-scene-moon', ART.moon, sky, SIZE.moon), frames: rise, timing: WHOLE },
  ];
  STARS.forEach((star, i) => {
    const name = `tc-scene-star-${i + 1}`;
    const at = { x: sky.x + star.at[0] * width, y: sky.y + star.at[1] * height };
    parts.push({
      name,
      el: body(name, ART.stars[i] ?? ART.stars[0], at, star.size),
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
  const sky = skyOf(width, height);
  const dawn = { x: Math.min(width * 0.8, Math.max(width * 0.22, origin.x + width * 0.22)), y: height * 0.62 };
  const below = height - dawn.y + SIZE.sun * 1.5;
  const rise: Keyframe[] = [
    { offset: 0, transform: move(0, below, 1, -16), opacity: 1 },
    { offset: 0.06, transform: move(0, below, 1, -16), opacity: 1, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { offset: 0.6, transform: move(0, 0, 1, -4), opacity: 1 },
    { offset: 0.78, transform: move(0, 0, 1, 0), opacity: 1, easing: 'ease-in' },
    { offset: 1, transform: move(0, -6, 1.06, 0), opacity: 0 },
  ];
  const slip: Keyframe[] = [
    { offset: 0, transform: move(0, 0), opacity: 0 },
    { offset: 0.06, transform: move(0, 0), opacity: 1, easing: 'cubic-bezier(0.32, 0, 0.67, 0)' },
    { offset: 0.42, transform: move(56, 92, 0.94, 20), opacity: 0 },
    { offset: 1, transform: move(56, 92, 0.94, 20), opacity: 0 },
  ];
  return [
    { name: 'tc-scene-moon', el: body('tc-scene-moon', ART.moon, sky, SIZE.moon), frames: slip, timing: WHOLE },
    { name: 'tc-scene-sun', el: body('tc-scene-sun', ART.sun, dawn, SIZE.sun), frames: rise, timing: WHOLE },
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
 * Puts the scene's bodies in the page, each its own view-transition layer, inside the transition's update (so the
 * new picture has them and the old one doesn't). They are hidden once their time is up, then removed.
 */
export async function mountScene(kind: SceneKind, origin: Point): Promise<Scene> {
  mounted?.remove();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const parts = kind === 'nightfall' ? nightfall(origin, width, height) : daybreak(origin, width, height);
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.dataset.themeScene = kind;
  stage.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;animation:tc-scene-done 1ms step-end ${SCENE_MS}ms both;`;
  for (const p of parts) stage.append(p.el);
  document.body.append(stage);
  mounted = stage;
  // Decoded before the new picture is taken, so no body is captured blank.
  await Promise.all(
    [...stage.querySelectorAll('img')].map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined)),
  );
  return {
    play: (root) => parts.map((p) => root.animate(p.frames, { ...p.timing, pseudoElement: `::view-transition-new(${p.name})` })),
    remove: () => {
      stage.remove();
      if (mounted === stage) mounted = null;
    },
  };
}

const sceneListeners = new Set<(kind: SceneKind) => void>();

/** Calls `listener` when a scene has played to its end (Kaatu could doze after nightfall, grin after daybreak). */
export function onThemeScene(listener: (kind: SceneKind) => void): () => void {
  sceneListeners.add(listener);
  return () => sceneListeners.delete(listener);
}

export function sceneEnded(kind: SceneKind): void {
  for (const listener of sceneListeners) listener(kind);
}
