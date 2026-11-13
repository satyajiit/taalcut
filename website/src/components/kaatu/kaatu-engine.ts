// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's life, as a state machine with no DOM and no timers of its own: the hook (use-kaatu.ts) calls `tick(now)` from
 * its one requestAnimationFrame and sleeps until the time `tick` returns. Everything it shows goes through a KaatuView.
 *
 * - A pose plays its act POSE_REPEATS times the first time it is on screen, then holds; a mood plays its opening once,
 *   then lives: blinks every 3 to 6 s, an antic every 8 to 15 s (a snack, a yawn, a wave, a wonder, a cheeky tongue,
 *   or a look around), and after 40 s with no input it nods off, waking with a yawn on the next.
 * - `look` turns the head toward the pointer through the in-between frames, and back home once it rests.
 * - `poke` plays the app's reactions in turn with a hop; four quick pokes make it dizzy.
 * - `beat` dances: bop left, bop right, a music note each, back home when the beats stop.
 * - Reduced motion: the still frame only; a poke is one calm face, crossfaded in and out.
 */
import { ANTICS, CALM_POKES, DIZZY, DOZE, POKES, SHY, THINKING, TURN_MS, WAKE, blinkClip, type Clip, type KaatuAntic } from './kaatu-acts';
import { facing, turnable, turnPath, type KaatuDirection, type KaatuFrame } from './kaatu-frames';
import { IDLE_ANTICS, LIFE, moodScript } from './kaatu-moods';
import type { KaatuMove } from './kaatu-moves';
import { breathOf, keyOf, openingOf, stillOf, type KaatuBreath, type KaatuPart, type KaatuView } from './kaatu-part';
import { POSES } from './kaatu-poses';

export { breathOf, stillOf, type KaatuBreath, type KaatuPart, type KaatuView };

type Kind = 'turn' | 'life' | 'opening' | 'poke' | 'doze' | 'wake';

interface Running {
  readonly beats: Clip;
  i: number;
  until: number;
  readonly kind: Kind;
  readonly then: (now: number) => void;
}

export class KaatuEngine {
  private part: KaatuPart;
  private shown: KaatuFrame;
  private clip: Running | null = null;
  private readonly opened = new Set<string>();
  private running = false;
  private lastInput = 0;
  private nextBlink = Infinity;
  private nextAntic = Infinity;
  private nextThink = Infinity;
  private thinkBeat = 0;
  private dozing = false;
  private looking: KaatuDirection | null = null;
  private lookUntil = 0;
  private lastPoke = -Infinity;
  private streak = 0;
  private pokes = 0;
  private danceUntil = 0;
  private danceLeft = false;
  private lastAntic: KaatuAntic | null = null;

  constructor(
    part: KaatuPart,
    private readonly view: KaatuView,
    private readonly random: () => number = Math.random,
  ) {
    this.part = part;
    this.shown = stillOf(part);
  }

  get frame(): KaatuFrame {
    return this.shown;
  }

  get asleep(): boolean {
    return this.dozing;
  }

  get active(): boolean {
    return this.running;
  }

  /** New props. A new pose or mood plays its opening (once each) and settles; reduced motion shows its still. */
  set(part: KaatuPart, now: number): void {
    const changed = keyOf(part) !== keyOf(this.part) || part.reduce !== this.part.reduce;
    this.part = part;
    if (!changed) return;
    this.dozing = false;
    this.view.breath(this.breath());
    if (part.reduce) {
      this.clip = null;
      this.looking = null;
      this.danceUntil = 0;
      this.show(stillOf(part), true);
      return;
    }
    if (this.running) this.begin(now);
  }

  /** On screen in a shown tab. */
  resume(now: number): void {
    this.running = true;
    this.lastInput = now;
    // A poke that came as it scrolled on screen (focus scrolls it in) plays out; its end settles.
    if (this.clip?.kind === 'poke') return;
    if (this.part.reduce) {
      this.show(stillOf(this.part), false);
      return;
    }
    this.begin(now);
  }

  /** Off screen or the tab hidden: everything stops where it is. */
  pause(): void {
    this.running = false;
    this.clip = null;
    this.looking = null;
    this.danceUntil = 0;
  }

  /** Advances to `now`; returns when it next needs a tick (Infinity: not until something happens). */
  tick(now: number): number {
    this.advance(now);
    if (this.clip) return this.clip.until;
    if (!this.running || this.part.reduce) return Infinity;
    if (this.danceUntil) {
      if (now < this.danceUntil) return this.danceUntil;
      this.danceUntil = 0;
      this.settle(now);
      return this.next(now);
    }
    if (this.looking) {
      if (now >= this.lookUntil) {
        this.looking = null;
        this.settle(now);
        return this.next(now);
      }
      if (this.shown !== this.looking) {
        this.turnTo(this.looking, now, 'turn', () => undefined);
        return this.next(now);
      }
      if (now >= this.nextBlink) {
        this.blink(now);
        return this.next(now);
      }
      return Math.min(this.lookUntil, this.nextBlink);
    }
    if (this.dozing) return Infinity;
    const life = this.life();
    if (life === 'still') return Infinity;
    if (life === 'think') {
      if (now >= this.nextThink) {
        this.turnTo(THINKING[this.thinkBeat++ % THINKING.length] ?? this.home(), now, 'life', () => undefined);
        this.nextThink = now + LIFE.think;
        return this.next(now);
      }
      return this.nextThink;
    }
    if (life === 'idle') {
      if (now - this.lastInput >= LIFE.doze) {
        this.doze(now);
        return this.next(now);
      }
      if (now >= this.nextAntic) {
        this.antic(now);
        return this.next(now);
      }
    }
    if (now >= this.nextBlink) {
      this.blink(now);
      return this.next(now);
    }
    return life === 'idle' ? Math.min(this.nextBlink, this.nextAntic, this.lastInput + LIFE.doze) : this.nextBlink;
  }

  /** A pointer, key or touch anywhere: resets the doze clock and wakes a dozing Kaatu. */
  input(now: number): void {
    this.lastInput = now;
    if (!this.dozing || !this.running || this.part.reduce) return;
    this.dozing = false;
    this.view.breath(this.breath());
    this.play(WAKE, now, 'wake', (t) => this.settle(t));
  }

  /** The way an interactive Kaatu should look (toward the pointer), or null when the pointer is out of reach. */
  look(direction: KaatuDirection | null, now: number): void {
    if (!this.running || this.part.reduce) return;
    if (direction === null) {
      if (this.looking) this.lookUntil = Math.min(this.lookUntil, now + 300);
      return;
    }
    this.input(now);
    this.looking = direction;
    this.lookUntil = now + LIFE.lookRest;
    // A look breaks off a turn or a bit of idle life, never a reaction or an opening.
    if (this.clip && (this.clip.kind === 'turn' || this.clip.kind === 'life')) this.clip = null;
  }

  /** A pointer resting on Kaatu: it goes shy, unless it is busy. */
  shy(now: number): void {
    if (!this.running || this.part.reduce || this.dozing || this.danceUntil) return;
    if (this.clip && this.clip.kind !== 'turn' && this.clip.kind !== 'life') return;
    this.play(SHY, now, 'poke', (t) => this.settle(t));
  }

  /** A click, a tap, or Enter or Space on the focused Kaatu. */
  poke(now: number): void {
    const wasAsleep = this.dozing;
    this.dozing = false;
    this.lastInput = now;
    this.danceUntil = 0;
    this.view.breath(this.breath());
    if (this.part.reduce) {
      const calm = CALM_POKES[this.pokes++ % CALM_POKES.length] ?? [];
      this.play(calm, now, 'poke', () => this.show(stillOf(this.part), true));
      return;
    }
    this.streak = now - this.lastPoke <= LIFE.quickPoke ? this.streak + 1 : 1;
    this.lastPoke = now;
    if (this.streak >= LIFE.dizzyAfter) {
      this.streak = 0;
      this.play(DIZZY, now, 'poke', (t) => this.settle(t));
      return;
    }
    const reaction = POKES[this.pokes++ % POKES.length] ?? [];
    const clip: Clip = wasAsleep ? [{ frame: 'surprised', ms: 220 }, ...reaction] : reaction;
    this.play(clip, now, 'poke', (t) => this.settle(t), this.streak > 1 ? 'boop' : 'hop');
  }

  /** A music beat: dance to it (bop left, bop right, a note each). A posed Kaatu keeps its pose and sways. */
  beat(now: number): void {
    if (!this.running || this.part.reduce) return;
    if (this.clip && (this.clip.kind === 'poke' || this.clip.kind === 'opening')) return;
    this.clip = null;
    this.looking = null;
    this.lastInput = now;
    if (this.dozing) {
      this.dozing = false;
      this.view.breath(this.breath());
    }
    this.danceLeft = !this.danceLeft;
    const side = this.danceLeft ? 'left' : 'right';
    const { pose } = this.part;
    this.show(pose ? POSES[pose].frame : side === 'left' ? 'bop-left' : 'bop-right', false);
    this.view.move(side === 'left' ? 'sway-left' : 'sway-right');
    this.view.note(side);
    this.danceUntil = now + LIFE.danceRest;
  }

  private breath(): KaatuBreath {
    return this.dozing ? 'asleep' : breathOf(this.part);
  }

  private home(): KaatuFrame {
    if (this.dozing) return 'sleepy';
    return this.part.pose ? POSES[this.part.pose].frame : moodScript(this.part.mood, this.part.toward).home;
  }

  private life(): 'idle' | 'blink' | 'think' | 'still' {
    return this.part.pose ? 'still' : moodScript(this.part.mood, this.part.toward).life;
  }

  private between([min, max]: readonly [number, number]): number {
    return min + this.random() * (max - min);
  }

  private next(now: number): number {
    return this.clip ? this.clip.until : now;
  }

  private show(frame: KaatuFrame, fade: boolean): void {
    if (frame === this.shown && !fade) return;
    this.shown = frame;
    this.view.show(frame, fade);
  }

  private begin(now: number): void {
    const key = keyOf(this.part);
    const opening = openingOf(this.part);
    this.looking = null;
    this.danceUntil = 0;
    // Unset: the settle that follows starts a fresh antic clock.
    this.nextAntic = 0;
    if (opening && !this.opened.has(key)) {
      this.opened.add(key);
      this.play(opening.clip, now, 'opening', (t) => this.settle(t), opening.move);
      return;
    }
    this.opened.add(key);
    this.settle(now);
  }

  /** Turn home (or to the pointer), then carry on living: a fresh blink clock, the antic clock kept. */
  private settle(now: number): void {
    this.turnTo(this.looking ?? this.home(), now, 'turn', (t) => {
      this.nextBlink = t + this.between(LIFE.blink);
      const life = this.life();
      if (life !== 'idle') this.nextAntic = Infinity;
      else if (!(this.nextAntic > t)) this.nextAntic = t + this.between(LIFE.antic);
      this.nextThink = life === 'think' ? t : Infinity;
    });
  }

  private play(clip: Clip, now: number, kind: Kind, then: (now: number) => void, move?: KaatuMove): void {
    const first = clip[0];
    if (!first) {
      this.clip = null;
      then(now);
      return;
    }
    this.clip = { beats: clip, i: 0, until: now + first.ms, kind, then };
    if (move) this.view.move(move);
    this.enter(first);
    this.advance(now);
  }

  private enter(beat: Clip[number]): void {
    this.show(beat.frame, this.part.reduce);
    if (beat.move && !this.part.reduce) this.view.move(beat.move);
  }

  private advance(now: number): void {
    for (let guard = 0; this.clip && now >= this.clip.until && guard < 256; guard += 1) {
      const running = this.clip;
      running.i += 1;
      const beat = running.beats[running.i];
      if (!beat) {
        this.clip = null;
        running.then(running.until);
        continue;
      }
      running.until += beat.ms;
      this.enter(beat);
    }
  }

  /** The head turns to `target` through the in-betweens (each TURN_MS), then shows it. */
  private turnTo(target: KaatuFrame, now: number, kind: Kind, then: (now: number) => void): void {
    const path = turnable(this.shown) || turnable(target) ? turnPath(facing(this.shown), facing(target)) : [];
    this.play([...path.map((frame) => ({ frame, ms: TURN_MS })), { frame: target, ms: 0 }], now, kind, then);
  }

  private blink(now: number): void {
    this.nextBlink = now + this.between(LIFE.blink);
    if (!turnable(this.shown)) return;
    const clip = blinkClip(facing(this.shown), true, this.random() < LIFE.doubleBlink);
    this.play(clip, now, 'life', (t) => this.turnTo(this.looking ?? this.home(), t, 'turn', () => undefined));
  }

  private antic(now: number): void {
    let name: KaatuAntic = this.random() < LIFE.look ? 'look' : (IDLE_ANTICS[Math.floor(this.random() * IDLE_ANTICS.length)] ?? 'wave');
    if (name === this.lastAntic) name = IDLE_ANTICS[(IDLE_ANTICS.indexOf(name) + 1) % IDLE_ANTICS.length] ?? 'wave';
    this.lastAntic = name;
    this.nextAntic = Infinity;
    this.play(ANTICS[name], now, 'life', (t) => {
      this.nextAntic = t + this.between(LIFE.antic);
      this.settle(t);
    });
  }

  private doze(now: number): void {
    this.play(DOZE, now, 'doze', () => {
      this.dozing = true;
      this.show('sleepy', false);
      this.view.breath('asleep');
    });
  }
}
