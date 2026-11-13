// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Reel } from '#content/schema';
import { DEMO_PHASES, type DemoPhase } from '#stores/demo';

/**
 * The hero's signature interaction, timed on the chosen reel's own beats (pure; test/unit/demo-pass.test.ts).
 *
 * The pass is counted in steps: the saved reel plays under its bar (5), the bar lifts off (1), flies into the app
 * window while its music beats are read (4), the camera roll is searched (3), one clip flies into each slot (1 each),
 * and a held beat (1, or more when the tempo falls between strides) before Approve opens. A step is one beat, or a
 * fold of beats (quarter, half, double, triple) picked so the whole pass lasts about 6–9 seconds whatever the reel's
 * tempo. The pass never approves: that is the visitor's.
 */
export const PASS_STEPS = { shelf: 5, lift: 1, template: 4, sift: 3, perPick: 1, hold: 1 } as const;
const TARGET = { min: 6, ideal: 7.5, max: 9 } as const;
const STRIDES = [0.25, 0.5, 1, 2, 3] as const;

/** The phases the pass times; `approved` waits for the visitor. */
export type TimedPhase = Exclude<DemoPhase, 'approved'>;
export const TIMED_PHASES: readonly TimedPhase[] = DEMO_PHASES.filter((p): p is TimedPhase => p !== 'approved');

export function phaseIndex(phase: DemoPhase): number {
  return DEMO_PHASES.indexOf(phase);
}

/** True when `phase` has reached `than` or gone past it. */
export function reached(phase: DemoPhase, than: DemoPhase): boolean {
  return phaseIndex(phase) >= phaseIndex(than);
}

/** The reel's mean beat length in seconds, from its beat list (or its tempo when the list is too short). */
export function beatLength(reel: Pick<Reel, 'beats' | 'tempo'>): number {
  const { beats } = reel;
  if (beats.length >= 2) {
    const span = (beats[beats.length - 1] ?? 0) - (beats[0] ?? 0);
    if (span > 0) return span / (beats.length - 1);
  }
  return 60 / Math.max(reel.tempo, 1);
}

/**
 * The time of beat `x` counted from the first beat, in seconds. Fractional beats fall between their neighbours, and
 * beats past the list carry on at the mean beat length, so a short reel still times a long pass.
 */
export function beatTime(reel: Pick<Reel, 'beats' | 'tempo'>, x: number): number {
  const { beats } = reel;
  const first = beats[0] ?? 0;
  const mean = beatLength(reel);
  if (x <= 0) return 0;
  const i = Math.floor(x);
  const frac = x - i;
  if (i + 1 < beats.length) {
    const a = (beats[i] ?? 0) - first;
    const b = (beats[i + 1] ?? 0) - first;
    return a + (b - a) * frac;
  }
  const last = Math.max(beats.length - 1, 0);
  return (beats[last] ?? 0) - first + (x - last) * mean;
}

export interface PassPlan {
  /** Beats per step: 0.25, 0.5, 1, 2 or 3. */
  readonly stride: number;
  /** One step, in seconds (the stride at the reel's mean beat). */
  readonly step: number;
  /** When each timed phase starts, in seconds from the start of the pass. */
  readonly phaseAt: Readonly<Record<TimedPhase, number>>;
  /** When each slot's pick lands, in slot order. */
  readonly landAt: readonly number[];
  /** When Approve opens: the end of the pass. */
  readonly total: number;
}

export function passPlan(reel: Pick<Reel, 'beats' | 'tempo' | 'slots'>): PassPlan {
  const build = (stride: number): PassPlan => {
    const at = (step: number) => Math.round(beatTime(reel, step * stride) * 1000) / 1000;
    const lift = PASS_STEPS.shelf;
    const template = lift + PASS_STEPS.lift;
    const sift = template + PASS_STEPS.template;
    const assembled = sift + PASS_STEPS.sift;
    const picked = assembled + reel.slots.length * PASS_STEPS.perPick;
    // A tempo that falls between two strides would end early: hold the finished cut a step or two longer instead.
    let hold: number = PASS_STEPS.hold;
    while (at(picked + hold) < TARGET.min && hold < 8) hold++;
    return {
      stride,
      step: Math.round(beatLength(reel) * stride * 1000) / 1000,
      phaseAt: { shelf: 0, lift: at(lift), template: at(template), sift: at(sift), assembled: at(assembled), ready: at(picked + hold) },
      landAt: reel.slots.map((_, i) => at(assembled + i * PASS_STEPS.perPick)),
      total: at(picked + hold),
    };
  };
  // The stride whose pass lands inside 6–9 s and nearest 7.5 s; failing that, the one nearest the window.
  const distance = ({ total: t }: PassPlan) => {
    const outside = t < TARGET.min ? TARGET.min - t : t > TARGET.max ? t - TARGET.max : 0;
    return outside * 100 + Math.abs(t - TARGET.ideal);
  };
  const plans = STRIDES.map(build).sort((a, b) => distance(a) - distance(b));
  return plans[0] ?? build(1);
}

export interface PassMoment {
  readonly phase: TimedPhase;
  /** Picks in their slots. */
  readonly landed: number;
  /** While the template is read: how far, 0–1. 0 before, 1 after. */
  readonly reading: number;
}

/** Where the pass is `t` seconds in. Before 0 it is the shelf; past the end it stays ready. */
export function momentAt(plan: PassPlan, t: number): PassMoment {
  const { phaseAt } = plan;
  let phase: TimedPhase = 'shelf';
  for (const p of TIMED_PHASES) if (t >= phaseAt[p]) phase = p;
  const landed = plan.landAt.filter((at) => t >= at).length;
  const span = phaseAt.sift - phaseAt.template;
  const reading = t < phaseAt.template ? 0 : t >= phaseAt.sift || span <= 0 ? 1 : (t - phaseAt.template) / span;
  return { phase, landed, reading };
}

/** Where a new pass starts its clock: the first run from the shelf; Use template and another reel from the lift. */
export function passStart(plan: PassPlan, run: number): number {
  return run === 0 ? 0 : plan.phaseAt.lift;
}

/** The index of the last beat at or before `sec` on the reel's clock (−1 before the first). */
export function beatIndexAt(reel: Pick<Reel, 'beats'>, sec: number): number {
  let index = -1;
  for (let i = 0; i < reel.beats.length; i++) {
    if ((reel.beats[i] ?? Infinity) <= sec + 1e-6) index = i;
    else break;
  }
  return index;
}

/** The slot playing at `sec` on the reel's clock (the last one past the end). */
export function slotIndexAt(reel: Pick<Reel, 'slots'>, sec: number): number {
  const i = reel.slots.findIndex((s) => sec >= s.start && sec < s.end);
  return i === -1 ? Math.max(reel.slots.length - 1, 0) : i;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Geometry: where things sit on the strip, as percentages of the reel, so the strip scales and never wraps.         */
/* ---------------------------------------------------------------------------------------------------------------- */

export interface SlotBox {
  readonly id: string;
  /** Left edge and width as a percentage of the strip. */
  readonly left: number;
  readonly width: number;
}

const pct = (n: number) => Math.round(n * 10_000) / 100;

export function slotGeometry(reel: Pick<Reel, 'slots' | 'durationSec'>): SlotBox[] {
  const d = reel.durationSec > 0 ? reel.durationSec : 1;
  return reel.slots.map((s) => {
    const start = Math.min(Math.max(s.start, 0), d);
    const end = Math.min(Math.max(s.end, start), d);
    return { id: s.id, left: pct(start / d), width: pct((end - start) / d) };
  });
}

export interface Tick {
  readonly left: number;
  /** Every fourth beat is a downbeat, drawn taller. */
  readonly down: boolean;
}

export function tickPositions(reel: Pick<Reel, 'beats' | 'durationSec'>): Tick[] {
  const d = reel.durationSec > 0 ? reel.durationSec : 1;
  return reel.beats.filter((b) => b >= 0 && b <= d).map((b, i) => ({ left: pct(b / d), down: i % 4 === 0 }));
}

/** A place in media, as the app writes it: m:ss.t ("0:02.5"). */
export function formatTimecode(sec: number): string {
  const tenths = Math.max(0, Math.round(sec * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}
