// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { DIZZY, POKES, WAKE } from '#components/kaatu/kaatu-acts';
import { KaatuEngine } from '#components/kaatu/kaatu-engine';
import type { KaatuFrame } from '#components/kaatu/kaatu-frames';
import { LIFE } from '#components/kaatu/kaatu-moods';
import type { KaatuPart, KaatuView } from '#components/kaatu/kaatu-part';
import { POSE_REPEATS, POSES } from '#components/kaatu/kaatu-poses';

/** A view that writes down what the engine shows, moves and says, with the time it happened. */
class Record implements KaatuView {
  readonly frames: { at: number; frame: KaatuFrame; fade: boolean }[] = [];
  readonly moves: { at: number; move: string }[] = [];
  readonly breaths: string[] = [];
  readonly notes: string[] = [];
  now = 0;
  show(frame: KaatuFrame, fade: boolean) {
    this.frames.push({ at: this.now, frame, fade });
  }
  move(move: string) {
    this.moves.push({ at: this.now, move });
  }
  breath(state: string) {
    this.breaths.push(state);
  }
  note(side: string) {
    this.notes.push(side);
  }
  last(): KaatuFrame | undefined {
    return this.frames.at(-1)?.frame;
  }
  shownFrom(t: number): KaatuFrame[] {
    return this.frames.filter((f) => f.at >= t).map((f) => f.frame);
  }
}

/** A seeded random, so the life's uneven pace is the same on every run. */
function seeded(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function setup(part: Partial<KaatuPart> = {}) {
  const view = new Record();
  const engine = new KaatuEngine({ mood: 'idle', toward: 'right', reduce: false, ...part }, view, seeded());
  /** Runs the engine like the hook does: to each time it asks for, a frame (16 ms) at a time when it asks for now. */
  const run = (to: number) => {
    let t = view.now;
    while (t < to) {
      view.now = t;
      const next = engine.tick(t);
      t = Number.isFinite(next) ? Math.min(Math.max(next, t + 16), to) : to;
    }
    view.now = to;
    engine.tick(to);
  };
  const at = (t: number) => {
    run(t);
    return engine.frame;
  };
  return { view, engine, run, at };
}

describe('Kaatu’s engine', () => {
  it('plays a pose’s act twice when it first arrives, then holds the pose', () => {
    const { view, engine, at } = setup({ pose: 'film' });
    engine.resume(0);
    const act = POSES.film.act ?? [];
    const length = act.reduce((sum, b) => sum + b.ms, 0) * POSE_REPEATS;
    expect(view.frames.map((f) => f.frame).slice(0, 3)).toEqual(['clapper']);
    expect(at(length - 1)).not.toBe(undefined);
    expect(view.frames.filter((f) => f.frame === 'clapper')).toHaveLength(POSE_REPEATS);
    expect(view.moves.map((m) => m.move)).toEqual(['boop', 'present', 'boop', 'present']);
    expect(at(length + 50)).toBe('film');
    // A pose holds: no blinks, no antics, no doze, however long it stays.
    const before = view.frames.length;
    expect(at(length + 60_000)).toBe('film');
    expect(view.frames.length).toBe(before);
    // Back on screen later, it carries on holding: the act plays once per page.
    engine.pause();
    engine.resume(length + 61_000);
    expect(engine.frame).toBe('film');
  });

  it('blinks every 3 to 6 s while idle, gets up to an antic every 8 to 15 s, and dozes after 40 s', () => {
    const { view, engine, at } = setup();
    engine.resume(0);
    at(2999);
    expect(view.frames).toHaveLength(0);
    at(6100);
    expect(view.shownFrom(0)).toContain('blink');
    at(15_200);
    const antics = new Set<KaatuFrame>(['snack', 'yawn-start', 'wave', 'curious', 'cheeky', 'glance-left']);
    const firstAntic = view.frames.find((f) => antics.has(f.frame));
    expect(firstAntic?.at).toBeGreaterThanOrEqual(8000);
    expect(firstAntic?.at).toBeLessThanOrEqual(15_100);
    expect(at(LIFE.doze - 100)).not.toBe('sleepy');
    expect(at(LIFE.doze + 3000)).toBe('sleepy');
    expect(engine.asleep).toBe(true);
    expect(view.breaths.at(-1)).toBe('asleep');
    // Asleep it stays still: nothing more until someone moves.
    const asleep = view.frames.length;
    at(LIFE.doze + 30_000);
    expect(view.frames.length).toBe(asleep);
    // A pointer wakes it with a yawn and a stretch, then it looks out again.
    engine.input(LIFE.doze + 30_000);
    expect(engine.asleep).toBe(false);
    expect(view.breaths.at(-1)).toBe('awake');
    expect(engine.frame).toBe('drowsy');
    at(LIFE.doze + 30_000 + 500);
    expect(view.moves.at(-1)?.move).toBe('stretch');
    const woke = WAKE.reduce((sum, b) => sum + b.ms, 0);
    expect(at(LIFE.doze + 30_000 + woke + 200)).toBe('center');
  });

  it('turns its head to the pointer through the in-betweens, and back once the pointer rests', () => {
    const { view, engine, at } = setup();
    engine.resume(0);
    view.now = 100;
    engine.look('left', 100);
    expect(at(400)).toBe('left');
    expect(view.shownFrom(100)).toEqual(['glance-left', 'left']);
    // Across: in-between, middle, in-between.
    view.now = 500;
    engine.look('right', 500);
    expect(at(800)).toBe('right');
    expect(view.shownFrom(500)).toEqual(['glance-left', 'center', 'glance-right', 'right']);
    expect(at(500 + LIFE.lookRest + 300)).toBe('center');
  });

  it('turns a posed Kaatu to the pointer too, and back to its pose', () => {
    const { engine, at } = setup({ pose: 'big-wave' });
    engine.resume(0);
    at(5000);
    engine.look('up-left', 5000);
    expect(at(5300)).toBe('up-left');
    expect(at(5000 + LIFE.lookRest + 400)).toBe('big-wave');
  });

  it('reacts to pokes in the app’s order, with a hop, and four quick pokes make it dizzy', () => {
    const { view, engine, at } = setup();
    engine.resume(0);
    view.now = 1000;
    engine.poke(1000);
    expect(view.last()).toBe(POKES[0]?.[0]?.frame);
    expect(view.moves.at(-1)?.move).toBe('hop');
    expect(at(1300)).toBe('heart');
    expect(at(3000)).toBe('center');
    view.now = 4000;
    engine.poke(4000);
    expect(engine.frame).toBe('surprised');
    // Quick pokes: a boop each, and the fourth is dizzy.
    for (const t of [5000, 5300, 5600]) {
      view.now = t;
      engine.poke(t);
    }
    expect(view.moves.slice(-2).map((m) => m.move)).toEqual(['boop', 'boop']);
    view.now = 5900;
    engine.poke(5900);
    expect(engine.frame).toBe(DIZZY[0]?.frame);
    expect(view.moves.at(-1)?.move).toBe('wobble');
    expect(at(5900 + 1100 + 300)).toBe('center');
  });

  it('dances on the beat: bop left, bop right, a note each, home when the beats stop', () => {
    const { view, engine, at } = setup();
    engine.resume(0);
    for (const [i, t] of [1000, 1500, 2000].entries()) {
      view.now = t;
      engine.beat(t);
      expect(engine.frame).toBe(i % 2 === 0 ? 'bop-left' : 'bop-right');
    }
    expect(view.notes).toEqual(['left', 'right', 'left']);
    expect(view.moves.map((m) => m.move)).toEqual(['sway-left', 'sway-right', 'sway-left']);
    expect(at(2000 + LIFE.danceRest - 100)).toBe('bop-left');
    expect(at(2000 + LIFE.danceRest + 200)).toBe('center');
  });

  it('keeps its pose while it dances, swaying with the beat', () => {
    const { view, engine, at } = setup({ pose: 'headphones' });
    engine.resume(0);
    at(4000);
    view.now = 4000;
    engine.beat(4000);
    view.now = 4400;
    engine.beat(4400);
    expect(engine.frame).toBe('headphones');
    expect(view.moves.slice(-2).map((m) => m.move)).toEqual(['sway-left', 'sway-right']);
    expect(view.notes).toEqual(['left', 'right']);
  });

  it('under reduced motion shows the still frame only, and a poke is one calm face, crossfaded', () => {
    const { view, engine, at } = setup({ mood: 'wave', reduce: true });
    engine.resume(0);
    expect(engine.frame).toBe('wave');
    expect(engine.tick(10)).toBe(Infinity);
    at(60_000);
    engine.look('left', 60_000);
    engine.beat(60_000);
    expect(engine.frame).toBe('wave');
    expect(view.moves).toHaveLength(0);
    view.now = 61_000;
    engine.poke(61_000);
    expect(view.frames.at(-1)).toEqual({ at: 61_000, frame: 'heart', fade: true });
    at(62_000);
    expect(view.frames.at(-1)).toEqual({ at: 61_900, frame: 'wave', fade: true });
    expect(view.moves).toHaveLength(0);
  });

  it('stops everything off screen, and never replays a mood’s opening when it comes back', () => {
    const { view, engine, at } = setup({ mood: 'wave' });
    engine.resume(0);
    expect(engine.frame).toBe('wave');
    expect(at(3000)).toBe('center');
    engine.pause();
    const paused = view.frames.length;
    expect(engine.tick(50_000)).toBe(Infinity);
    expect(view.frames.length).toBe(paused);
    engine.resume(60_000);
    expect(engine.frame).toBe('center');
  });

  it('lets a poke that came as it scrolled on screen play out', () => {
    const { view, engine, at } = setup({ reduce: true });
    view.now = 100;
    engine.poke(100);
    expect(engine.frame).toBe('heart');
    engine.resume(120);
    expect(engine.frame).toBe('heart');
    expect(at(1100)).toBe('center');
  });

  it('plays a new mood’s opening when a section switches it', () => {
    const { engine, at } = setup({ mood: 'glance' });
    engine.resume(0);
    expect(at(100)).toBe('right');
    engine.set({ mood: 'delighted', toward: 'right', reduce: false }, 200);
    expect(engine.frame).toBe('content');
    expect(at(800)).toBe('heart');
    expect(at(2000)).toBe('content');
  });
});
