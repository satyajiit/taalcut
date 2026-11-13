// @ts-check
// Taalcut logo motion: the choreography.
//
// Pure data and maths, no DOM. The <taalcut-mark> component, the test bench, the timing
// diagrams, the animated SVG and the video stings all play these timelines, so they
// cannot drift apart.
//
// The grammar comes from how jhaptaal is counted by hand: ten beats (matras) in four
// groups, 2+3+2+3, marked clap, clap, wave, clap, and every cycle resolves back on beat
// one (sam). The logo's four arcs are those four groups.
//
// A motion compiles to a timeline of keyframe channels. Each channel is a list of
// keyframes { t, v, ease }, where `ease` shapes the segment that starts at that keyframe,
// exactly like a CSS keyframe's animation-timing-function. A timeline can therefore be
// sampled here or compiled to CSS @keyframes with the same result.

import { SPANS } from './mark-geometry.js';

/** Arc indices, clockwise from the top. */
export const SAM = 0;
export const CLAP_2 = 1;
export const KHALI = 2;
export const CLAP_3 = 3;

/** Easing curves as CSS cubic-bezier control points. */
export const EASE = {
  strike: [0.16, 1, 0.3, 1], // the attack of a hit; same curve as --ease-out
  settle: [0.22, 1, 0.36, 1], // the decay back to rest
  wave: [0.65, 0, 0.35, 1], // the empty beat's dip and return; same curve as --ease-in-out
  linear: [0, 0, 1, 1],
};

/** Hits: radial push in ring-grid units (the ring is 224 across), attack and decay in ms. */
export const HIT = {
  landing: { push: 12, attack: 90, decay: 520 }, // the return to beat one
  sam: { push: 8, attack: 70, decay: 340 },
  clap: { push: 5, attack: 70, decay: 320 },
  tick: { push: 3, attack: 60, decay: 240 }, // progress, one per completed beat
};

/** Arrival in the count-in: arcs drop in from 16 units out; the empty beat fades in instead. */
export const ARRIVE = { from: 16, fade: 90, settle: 380, soft: 280 };

/** The empty beat's wave: it dims to (1 - depth) and returns. Duration is two beats, clamped. */
export const WAVE = { depth: 0.6, min: 220, max: 1200 };

/** The kit's small drawing applies below 40 px (symbol) or 160 px wide (lockup). There a push would
 * be a sub-pixel shimmer, so hits become a dip in opacity. */
export const SMALL = { below: 40, lockupBelow: 160, dip: 0.45 };

/** Wordmark entrance in the lockup: from 10 units left, on the landing. */
export const WORD = { from: -10, delay: 40, fade: 240, settle: 420 };

/** One beat (matra), in ms, per motion. */
export const MATRA = { countIn: 125, tihai: 95, thinking: 700, keepTime: 500, min: 333, max: 1000 };

/** Crossfade when one motion replaces another, ms. */
export const BLEND = 90;

/** Reduced motion: everything becomes a fade of this length (DESIGN.md). */
export const REDUCED_FADE = 150;

/** Jhaptaal's theka, one entry per beat, with the arc that beat belongs to. */
export const THEKA = [
  { matra: 1, bol: 'dhi', sign: 'X', arc: SAM },
  { matra: 2, bol: 'na', sign: '', arc: SAM },
  { matra: 3, bol: 'dhi', sign: '2', arc: CLAP_2 },
  { matra: 4, bol: 'dhi', sign: '', arc: CLAP_2 },
  { matra: 5, bol: 'na', sign: '', arc: CLAP_2 },
  { matra: 6, bol: 'ti', sign: '0', arc: KHALI },
  { matra: 7, bol: 'na', sign: '', arc: KHALI },
  { matra: 8, bol: 'dhi', sign: '3', arc: CLAP_3 },
  { matra: 9, bol: 'dhi', sign: '', arc: CLAP_3 },
  { matra: 10, bol: 'na', sign: '', arc: CLAP_3 },
];

/** First beat (0-based) of each arc's group: 2 + 3 + 2 + 3. */
export const GROUP_STARTS = [0, 2, 5, 7];
const GROUP_SIZES = [2, 3, 2, 3];

/** Angle (degrees clockwise from the top) where each beat ends: 11 boundaries, 0 to 360. */
export const BEAT_ANGLES = (() => {
  const out = [0];
  let a = 0;
  SPANS.forEach((span, i) => {
    for (let k = 0; k < GROUP_SIZES[i]; k++) out.push((a += span / GROUP_SIZES[i]));
  });
  return out;
})();

/** Progress 0–1 as a lit angle: each tenth of the work lights exactly one beat. */
export function progressAngle(p) {
  const x = Math.min(10, Math.max(0, p * 10));
  const i = Math.min(9, Math.floor(x));
  return BEAT_ANGLES[i] + (BEAT_ANGLES[i + 1] - BEAT_ANGLES[i]) * (x - i);
}

/** Folds a reference reel's tempo into a beat between 333 and 1000 ms (60–180 BPM). */
export function matraFromBpm(bpm) {
  if (!(bpm > 0)) return MATRA.keepTime;
  let m = 60000 / bpm;
  while (m < MATRA.min) m *= 2;
  while (m > MATRA.max) m /= 2;
  return m;
}

// ---------- easing: the same cubic-bezier maths browsers use ----------

/** @param {number[]} p control points [x1, y1, x2, y2] @param {number} x progress 0–1 */
export function bezier([x1, y1, x2, y2], x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (/** @type {number} */ t) => ((ax * t + bx) * t + cx) * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = fx(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (t < 0 || t > 1 || Math.abs(fx(t) - x) > 1e-4) {
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      if (fx(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

// ---------- timelines ----------

/**
 * @typedef {{ t: number, v: number, ease: number[] }} Key
 * @typedef {{ t: number, matra: number, bol: string, sign: string, arc: number, landing?: boolean }} Beat
 * @typedef {{ name: string, duration: number, loop: boolean, initial: Record<string, number>,
 *   channels: Record<string, Key[]>, beats: Beat[] }} Timeline
 * @typedef {{ arcs: { push: number, alpha: number }[], word: { alpha: number, shift: number } }} Frame
 */

/** Values at rest: every arc in place and opaque, the wordmark in place. */
export const REST = Object.freeze({
  'arc0.push': 0, 'arc1.push': 0, 'arc2.push': 0, 'arc3.push': 0,
  'arc0.alpha': 1, 'arc1.alpha': 1, 'arc2.alpha': 1, 'arc3.alpha': 1,
  'word.alpha': 1, 'word.shift': 0,
});

/** @param {Key[]} keys @param {number} initial @param {number} t */
export function sampleChannel(keys, initial, t) {
  if (!keys || !keys.length || t < keys[0].t) return initial;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (t >= k.t) {
      const next = keys[i + 1];
      if (!next || next.t === k.t) return next ? next.v : k.v;
      return k.v + (next.v - k.v) * bezier(k.ease, (t - k.t) / (next.t - k.t));
    }
  }
  return initial;
}

class Score {
  /** @param {string} name @param {boolean} [loop] */
  constructor(name, loop = false) {
    /** @type {Timeline} */
    this.tl = { name, duration: 0, loop, initial: { ...REST }, channels: {}, beats: [] };
  }

  /** Cuts a channel at t (a retrigger) and returns the value it had there. */
  cut(ch, t) {
    const keys = (this.tl.channels[ch] ??= []);
    const v = sampleChannel(keys, this.tl.initial[ch], t);
    while (keys.length && keys[keys.length - 1].t >= t) keys.pop();
    return v;
  }

  /** Appends a run of segments: points = [[dt, value, ease], ...], dt from t. */
  run(ch, t, points) {
    const keys = this.tl.channels[ch];
    for (const [dt, v, ease] of points) keys.push({ t: t + dt, v, ease });
  }

  hit(arc, t, { push, attack, decay }, small = false, scale = 1) {
    if (small) {
      const ch = `arc${arc}.alpha`;
      const v0 = this.cut(ch, t);
      this.run(ch, t, [[0, v0, EASE.strike], [attack, 1 - SMALL.dip * scale, EASE.settle], [attack + decay, 1, EASE.linear]]);
      return;
    }
    const ch = `arc${arc}.push`;
    const v0 = this.cut(ch, t);
    this.run(ch, t, [[0, v0, EASE.strike], [attack, push * scale, EASE.settle], [attack + decay, 0, EASE.linear]]);
  }

  wave(arc, t, duration, depth = WAVE.depth) {
    const ch = `arc${arc}.alpha`;
    const v0 = this.cut(ch, t);
    this.run(ch, t, [[0, v0, EASE.wave], [duration / 2, 1 - depth, EASE.wave], [duration, 1, EASE.linear]]);
  }

  beat(t, index, extra = {}) {
    this.tl.beats.push({ t, ...THEKA[index % 10], ...extra });
  }

  /** @param {number} duration @returns {Timeline} */
  done(duration) {
    this.tl.duration = duration;
    return this.tl;
  }
}

/**
 * Count-in: the logo's entrance. The arcs arrive on the first beat of their groups
 * (1, 3, 6, 8), so the entrance plays jhaptaal's 2+3+2+3; the empty beat fades in
 * instead of dropping. Beat eleven is beat one again: the landing, and the wordmark.
 */
export function countIn({ matra = MATRA.countIn, small = false, lockup = false } = {}) {
  const s = new Score('count-in');
  for (let i = 0; i < 4; i++) {
    s.tl.initial[`arc${i}.alpha`] = 0;
    if (!small && i !== KHALI) s.tl.initial[`arc${i}.push`] = ARRIVE.from;
  }
  for (let i = 0; i < 4; i++) {
    const t = GROUP_STARTS[i] * matra;
    const a = `arc${i}.alpha`;
    s.cut(a, t);
    if (i === KHALI) {
      s.run(a, t, [[0, 0, EASE.wave], [ARRIVE.soft, 1, EASE.linear]]);
    } else {
      s.run(a, t, [[0, 0, EASE.strike], [ARRIVE.fade, 1, EASE.linear]]);
      if (!small) {
        const p = `arc${i}.push`;
        s.cut(p, t);
        s.run(p, t, [[0, ARRIVE.from, EASE.settle], [ARRIVE.settle, 0, EASE.linear]]);
      }
    }
  }
  for (let b = 0; b < 10; b++) s.beat(b * matra, b);
  const landing = 10 * matra;
  if (!small) s.hit(SAM, landing, HIT.landing);
  s.beat(landing, 0, { landing: true });
  let end = landing + HIT.landing.attack + HIT.landing.decay;
  if (lockup) {
    const t = landing + WORD.delay;
    s.tl.initial['word.alpha'] = 0;
    s.tl.initial['word.shift'] = WORD.from;
    s.cut('word.alpha', t);
    s.run('word.alpha', t, [[0, 0, EASE.strike], [WORD.fade, 1, EASE.linear]]);
    s.cut('word.shift', t);
    s.run('word.shift', t, [[0, WORD.from, EASE.settle], [WORD.settle, 0, EASE.linear]]);
    end = Math.max(end, t + WORD.settle);
  }
  return s.done(end);
}

/**
 * Tihai: the celebration. In Hindustani music a tihai is a phrase played three times
 * whose last stroke lands on sam. Here the phrase is clap, wave, clap (the three arcs
 * after beat one), played three times with a crescendo, then the landing on beat one.
 */
export function tihai({ matra = MATRA.tihai, small = false } = {}) {
  const s = new Score('tihai');
  const phrase = [CLAP_2, KHALI, CLAP_3];
  const strength = [0.6, 0.8, 1];
  const push = { ...HIT.sam };
  for (let p = 0; p < 3; p++) {
    for (let j = 0; j < 3; j++) {
      const t = (p * 4 + j) * matra;
      const arc = phrase[j];
      if (arc === KHALI) s.wave(KHALI, t, Math.max(2 * matra, WAVE.min), WAVE.depth * strength[p]);
      else s.hit(arc, t, push, small, strength[p]);
      s.beat(t, GROUP_STARTS[arc], { arc });
    }
  }
  const landing = 11 * matra;
  s.hit(SAM, landing, HIT.landing, small);
  s.beat(landing, 0, { landing: true });
  return s.done(landing + HIT.landing.attack + HIT.landing.decay);
}

/**
 * Keep time: a loop for work of unknown length. Claps on beats 1, 3 and 8, the wave on
 * beat 6, at the reference reel's tempo when there is one.
 */
export function keepTime({ bpm = 0, matra = 0, small = false } = {}) {
  const m = matra || matraFromBpm(bpm);
  const s = new Score('keep-time', true);
  s.hit(SAM, 0, HIT.sam, small);
  s.hit(CLAP_2, GROUP_STARTS[CLAP_2] * m, HIT.clap, small);
  s.wave(KHALI, GROUP_STARTS[KHALI] * m, Math.min(WAVE.max, Math.max(WAVE.min, 2 * m)));
  s.hit(CLAP_3, GROUP_STARTS[CLAP_3] * m, HIT.clap, small);
  for (let b = 0; b < 10; b++) s.beat(b * m, b);
  return s.done(10 * m);
}

/** Thinking: only the empty beat moves. It is the violet arc, the colour of the agent. */
export function thinking({ matra = MATRA.thinking } = {}) {
  const s = new Score('thinking', true);
  s.wave(KHALI, 0, 2 * matra, 0.55);
  return s.done(2 * matra);
}

/** Tap: one stroke on beat one, for hover and press. */
export function tap({ small = false } = {}) {
  const s = new Score('tap');
  s.hit(SAM, 0, HIT.sam, small);
  return s.done(HIT.sam.attack + HIT.sam.decay);
}

/** Reduced-motion stand-ins: a 150 ms fade, or nothing at all. */
export function reducedFadeIn({ lockup = false } = {}) {
  const s = new Score('fade-in');
  const chans = ['arc0.alpha', 'arc1.alpha', 'arc2.alpha', 'arc3.alpha', ...(lockup ? ['word.alpha'] : [])];
  for (const ch of chans) {
    s.tl.initial[ch] = 0;
    s.cut(ch, 0);
    s.run(ch, 0, [[0, 0, EASE.linear], [REDUCED_FADE, 1, EASE.linear]]);
  }
  return s.done(REDUCED_FADE);
}

export function still(name = 'still', duration = REDUCED_FADE) {
  return new Score(name).done(duration);
}

/** The value of one hit's push at time t after it starts (used for progress ticks). */
export function hitAt(t, { push, attack, decay }) {
  if (t < 0 || t > attack + decay) return 0;
  return t < attack ? push * bezier(EASE.strike, t / attack) : push * (1 - bezier(EASE.settle, (t - attack) / decay));
}

/** @param {Timeline} tl @param {number} t ms @returns {Frame} */
export function sample(tl, t) {
  const time = tl.loop ? ((t % tl.duration) + tl.duration) % tl.duration : Math.min(Math.max(t, 0), tl.duration);
  const v = (/** @type {string} */ ch) => sampleChannel(tl.channels[ch], tl.initial[ch], time);
  return {
    arcs: [0, 1, 2, 3].map((i) => ({ push: v(`arc${i}.push`), alpha: v(`arc${i}.alpha`) })),
    word: { alpha: v('word.alpha'), shift: v('word.shift') },
  };
}

/** @param {Frame} a @param {Frame} b @param {number} k 0–1 @returns {Frame} */
export function mix(a, b, k) {
  const l = (/** @type {number} */ x, /** @type {number} */ y) => x + (y - x) * k;
  return {
    arcs: a.arcs.map((p, i) => ({ push: l(p.push, b.arcs[i].push), alpha: l(p.alpha, b.arcs[i].alpha) })),
    word: { alpha: l(a.word.alpha, b.word.alpha), shift: l(a.word.shift, b.word.shift) },
  };
}

/** @returns {Frame} */
export function restFrame() {
  return { arcs: [0, 1, 2, 3].map(() => ({ push: 0, alpha: 1 })), word: { alpha: 1, shift: 0 } };
}

/** All one-shot and looping motions by name. */
export const MOTIONS = { 'count-in': countIn, tihai, 'keep-time': keepTime, thinking, tap };
