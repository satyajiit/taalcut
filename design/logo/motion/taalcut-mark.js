// @ts-check
// <taalcut-mark>: the logo, with its motion. One custom element for the Electron app,
// React 19 (which passes props and events to custom elements natively), the website
// and docs. No dependencies; the motion grammar lives in choreography.js.
//
//   <taalcut-mark></taalcut-mark>                          the symbol, at rest
//   <taalcut-mark variant="lockup" autoplay></taalcut-mark> plays the count-in once
//   <taalcut-mark state="keep-time" bpm="96"></taalcut-mark>
//   <taalcut-mark state="progress" progress="0.42" label="Rendering"></taalcut-mark>
//   el.play('tihai')                                       returns a promise
//
// Colours come from the --color-logo-* tokens (design/tokens), so the mark follows the
// app's light and dark themes, including a manual override. Pages without the tokens
// fall back to the kit's hex values and the OS colour scheme.

import { LOCKUP, SYMBOL, BISECTORS } from './mark-geometry.js';
import {
  BEAT_ANGLES, BLEND, EASE, HIT, MOTIONS, SAM, SMALL, THEKA,
  bezier, hitAt, mix, progressAngle, reducedFadeIn, restFrame, sample, still,
} from './choreography.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LIT_TIME = 160; // ms: the lit sweep eases toward the reported progress
const GHOST = 0.22; // unlit arcs in the progress state
let uid = 0;

const STYLE = `
:host {
  --_1: #A94E00; --_2: #B02B57; --_3: #6347B8; --_4: #056965; --_ink: #1E1712;
  display: inline-block; vertical-align: middle; line-height: 0;
  height: 48px; aspect-ratio: 1;
}
@media (prefers-color-scheme: dark) {
  :host { --_1: #FAAB3F; --_2: #F26A90; --_3: #9E8CF4; --_4: #3CC2B4; --_ink: #F0ECE7; }
}
:host([variant="lockup"]) { aspect-ratio: ${LOCKUP.width} / ${LOCKUP.height}; }
:host([hidden]) { display: none; }
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.a0 { fill: var(--color-logo-1, var(--_1)); }
.a1 { fill: var(--color-logo-2, var(--_2)); }
.a2 { fill: var(--color-logo-3, var(--_3)); }
.a3 { fill: var(--color-logo-4, var(--_4)); }
.w { fill: var(--color-logo-ink, var(--_ink)); }
:host([palette="two"]) .a1, :host([palette="two"]) .a2, :host([palette="two"]) .a3 { fill: var(--color-logo-ink, var(--_ink)); }
:host([palette="mono"]) path { fill: currentColor; }
.ghost { display: none; opacity: ${GHOST}; }
:host([state="progress"]) .ghost { display: inline; }
`;

/**
 * @typedef {import('./choreography.js').Timeline} Timeline
 * @typedef {import('./choreography.js').Frame} Frame
 * @typedef {{ tl: Timeline, start: number, last: number, resolve?: () => void }} Playing
 */

export class TaalcutMarkElement extends HTMLElement {
  static observedAttributes = ['variant', 'palette', 'state', 'bpm', 'progress', 'motion', 'label'];

  #internals = this.attachInternals();
  #root = this.attachShadow({ mode: 'open' });
  /** @type {SVGGElement[]} */ #arcs = [];
  /** @type {SVGPathElement[][]} */ #paths = [];
  /** @type {SVGGElement | null} */ #word = null;
  /** @type {SVGPathElement | null} */ #wedge = null;
  #maskId = `taalcut-lit-${++uid}`;

  /** @type {Playing | null} */ #loop = null;
  /** @type {Playing | null} */ #once = null;
  /** @type {{ from: Frame, start: number } | null} */ #blend = null;
  /** @type {Frame} */ #shown = restFrame();
  /** @type {{ arc: number, start: number, hit: typeof HIT.tick }[]} */ #extra = [];
  #lit = 0;
  #litFrom = 0;
  #litAt = 0;
  #raf = 0;
  #visible = true;
  #small = false;
  #dark = false;
  #built = false;

  #reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  #darkQuery = matchMedia('(prefers-color-scheme: dark)');
  /** @type {ResizeObserver | null} */ #resize = null;
  /** @type {IntersectionObserver | null} */ #seen = null;
  /** @type {MutationObserver | null} */ #theme = null;
  #onMedia = () => { this.#updateGeometry(); this.#syncState(); };

  // ---------- properties (React 19 sets these directly) ----------

  get variant() { return this.getAttribute('variant') === 'lockup' ? 'lockup' : 'symbol'; }
  set variant(v) { this.setAttribute('variant', String(v)); }
  get palette() { return this.getAttribute('palette') ?? 'four'; }
  set palette(v) { this.setAttribute('palette', String(v)); }
  get state() { return this.getAttribute('state') ?? 'idle'; }
  set state(v) { this.setAttribute('state', String(v)); }
  get bpm() { return Number(this.getAttribute('bpm')) || 0; }
  set bpm(v) { this.setAttribute('bpm', String(v)); }
  get progress() { return Math.min(1, Math.max(0, Number(this.getAttribute('progress')) || 0)); }
  set progress(v) { this.setAttribute('progress', String(v)); }
  get motion() { return this.getAttribute('motion') ?? 'auto'; }
  set motion(v) { this.setAttribute('motion', String(v)); }
  get label() { return this.getAttribute('label') ?? ''; }
  set label(v) { this.setAttribute('label', String(v)); }

  /** True when motion is reduced: the OS setting, unless motion="full" overrides it. */
  get reducedMotion() {
    return this.motion === 'reduced' || (this.motion !== 'full' && this.#reducedQuery.matches);
  }

  // ---------- lifecycle ----------

  connectedCallback() {
    if (!this.#built) this.#build();
    this.#resize = new ResizeObserver(([entry]) => {
      // The kit's rule for the small drawing: symbol under 40 px, horizontal lockup under 160 px wide.
      const { width, height } = entry.contentRect;
      const small = this.variant === 'lockup' ? width > 0 && width < SMALL.lockupBelow : height > 0 && height < SMALL.below;
      if (small !== this.#small) {
        this.#small = !this.#small;
        this.#updateGeometry();
        this.#syncState();
      }
    });
    this.#resize.observe(this);
    this.#seen = new IntersectionObserver(([entry]) => {
      const back = entry.isIntersecting && !this.#visible;
      this.#visible = entry.isIntersecting;
      // Off screen nothing animates; back on screen the sweep shows where the work is, without a burst of ticks.
      if (back && this.state === 'progress') this.#setProgress(true);
      if (this.#visible) this.#tick();
    });
    this.#seen.observe(this);
    this.#theme = new MutationObserver(() => this.#updateGeometry());
    this.#theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.#reducedQuery.addEventListener('change', this.#onMedia);
    this.#darkQuery.addEventListener('change', this.#onMedia);
    this.#updateGeometry();
    this.#updateAria();
    this.#lit = this.#litFrom = progressAngle(this.progress);
    if (this.hasAttribute('autoplay') && this.#shouldAutoplay()) this.play('count-in');
    else this.#syncState();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#resize?.disconnect();
    this.#seen?.disconnect();
    this.#theme?.disconnect();
    this.#reducedQuery.removeEventListener('change', this.#onMedia);
    this.#darkQuery.removeEventListener('change', this.#onMedia);
  }

  attributeChangedCallback(name, before, after) {
    if (!this.#built || before === after) return;
    if (name === 'variant') { this.#build(); this.#updateGeometry(); }
    if (name === 'state' || name === 'bpm' || name === 'motion') this.#syncState();
    if (name === 'progress') this.#setProgress();
    if (name === 'state' || name === 'label' || name === 'progress') this.#updateAria();
  }

  // ---------- public methods ----------

  /**
   * Plays a one-shot motion: 'count-in', 'tihai' or 'tap'. Resolves when it ends.
   * A new motion replaces the one playing, crossfading over 90 ms.
   * @param {'count-in' | 'tihai' | 'tap'} name
   * @returns {Promise<void>}
   */
  play(name) {
    const lockup = this.variant === 'lockup';
    let tl;
    if (this.reducedMotion) tl = name === 'count-in' ? reducedFadeIn({ lockup }) : still(name);
    else tl = MOTIONS[name]({ small: this.#small, lockup });
    this.#once?.resolve?.();
    return new Promise((resolve) => {
      const now = performance.now();
      this.#startBlend(now, name === 'count-in');
      this.#once = { tl, start: now, last: -1, resolve };
      if (name === 'count-in') this.#apply(sample(tl, 0)); // hidden before the first frame paints
      this.#tick();
    });
  }

  /** Stops any motion and shows the mark at rest. */
  stop() {
    this.#once?.resolve?.();
    this.#once = this.#loop = this.#blend = null;
    this.#extra = [];
    this.#apply(this.#resting());
  }

  /**
   * Shows one frame of a motion without playing it: for test benches and storyboards.
   * @param {keyof typeof MOTIONS} name @param {number} ms
   */
  scrub(name, ms) {
    this.stop();
    const tl = MOTIONS[name]({ small: this.#small, lockup: this.variant === 'lockup', bpm: this.bpm });
    this.#apply(sample(tl, ms));
  }

  // ---------- rendering ----------

  #build() {
    const g = this.variant === 'lockup' ? LOCKUP : SYMBOL;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<defs><mask id="${this.#maskId}" maskUnits="userSpaceOnUse" x="-64" y="-64" width="${g.width + 128}" height="${g.height + 128}">` +
      `<path class="wedge" fill="#fff"/></mask></defs>`;
    this.#wedge = /** @type {SVGPathElement} */ (svg.querySelector('.wedge'));
    this.#arcs = [];
    this.#paths = [];
    for (let i = 0; i < 4; i++) {
      const arc = document.createElementNS(SVG_NS, 'g');
      const ghost = document.createElementNS(SVG_NS, 'path');
      const lit = document.createElementNS(SVG_NS, 'path');
      ghost.setAttribute('class', `ghost a${i}`);
      lit.setAttribute('class', `lit a${i}`);
      arc.append(ghost, lit);
      svg.append(arc);
      this.#arcs.push(arc);
      this.#paths.push([ghost, lit]);
    }
    this.#word = null;
    if (this.variant === 'lockup') {
      const word = document.createElementNS(SVG_NS, 'g');
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'w');
      p.setAttribute('fill-rule', 'evenodd');
      p.setAttribute('d', LOCKUP.wordmark);
      word.append(p);
      svg.append(word);
      this.#word = word;
    }
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.#root.replaceChildren(style, svg);
    this.#built = true;
    this.#apply(this.#shown);
  }

  /** Picks the drawing: the small one below 40 px, the thinned one on dark backgrounds. */
  #updateGeometry() {
    const scheme = getComputedStyle(this).colorScheme || '';
    this.#dark = scheme.includes('dark') && !scheme.includes('light') ? true
      : scheme.includes('light') && !scheme.includes('dark') ? false : this.#darkQuery.matches;
    const key = `${this.#small ? 'small' : ''}${this.#small && this.#dark ? '-' : ''}${this.#dark ? 'reversed' : ''}` || 'standard';
    const arcs = (this.variant === 'lockup' ? LOCKUP : SYMBOL).arcs[key];
    this.#paths.forEach(([ghost, lit], i) => {
      ghost.setAttribute('d', arcs[i]);
      lit.setAttribute('d', arcs[i]);
    });
  }

  #updateAria() {
    const progress = this.state === 'progress';
    this.#internals.role = progress ? 'progressbar' : 'img';
    this.#internals.ariaLabel = this.label || (progress ? 'Progress' : 'Taalcut');
    this.#internals.ariaValueMin = progress ? '0' : null;
    this.#internals.ariaValueMax = progress ? '100' : null;
    this.#internals.ariaValueNow = progress ? String(Math.round(this.progress * 100)) : null;
  }

  /** @param {Frame} f @param {number} [now] */
  #apply(f, now = performance.now()) {
    this.#shown = f;
    const g = this.variant === 'lockup' ? LOCKUP : SYMBOL;
    const canPush = !this.#small; // below 40 px a push is sub-pixel shimmer; small timelines use opacity
    this.#arcs.forEach((arc, i) => {
      let push = f.arcs[i].push;
      for (const e of this.#extra) if (e.arc === i) push += hitAt(now - e.start, e.hit);
      const a = (BISECTORS[i] * Math.PI) / 180;
      arc.setAttribute('transform', push && canPush ? `translate(${(push * Math.cos(a)).toFixed(2)} ${(push * Math.sin(a)).toFixed(2)})` : '');
      arc.setAttribute('opacity', f.arcs[i].alpha >= 0.999 ? '1' : f.arcs[i].alpha.toFixed(3));
    });
    if (this.#word) {
      this.#word.setAttribute('transform', f.word.shift ? `translate(${f.word.shift.toFixed(2)} 0)` : '');
      this.#word.setAttribute('opacity', f.word.alpha.toFixed(3));
    }
    this.#drawWedge(g);
  }

  /** Masks the lit arcs with a wedge from the top, clockwise, as wide as the progress. */
  #drawWedge(g) {
    const on = this.state === 'progress';
    for (const [, lit] of this.#paths) {
      if (on) lit.setAttribute('mask', `url(#${this.#maskId})`);
      else lit.removeAttribute('mask');
    }
    if (!on || !this.#wedge) return;
    const deg = this.#lit;
    const R = 160;
    if (deg >= 359.999) {
      this.#wedge.setAttribute('d', `M${g.cx - R} ${g.cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`);
      return;
    }
    if (deg <= 0) { this.#wedge.setAttribute('d', ''); return; }
    const a = ((deg - 90) * Math.PI) / 180;
    const x = g.cx + R * Math.cos(a);
    const y = g.cy + R * Math.sin(a);
    this.#wedge.setAttribute('d', `M${g.cx} ${g.cy}L${g.cx} ${g.cy - R}A${R} ${R} 0 ${deg > 180 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`);
  }

  // ---------- the clock ----------

  #startBlend(now, fromHidden = false) {
    this.#blend = fromHidden ? null : { from: this.#shown, start: now };
  }

  /** Background motion for the current state. */
  #syncState() {
    const now = performance.now();
    const reduced = this.reducedMotion;
    let tl = null;
    if (this.state === 'keep-time' && !reduced) tl = MOTIONS['keep-time']({ bpm: this.bpm, small: this.#small });
    if (this.state === 'thinking') tl = reduced ? null : MOTIONS.thinking();
    const same = this.#loop && tl && this.#loop.tl.name === tl.name && this.#loop.tl.duration === tl.duration;
    if (!same) {
      this.#startBlend(now);
      this.#loop = tl ? { tl, start: now, last: -1 } : null;
    }
    this.#extra = [];
    this.#setProgress(true);
    this.#tick();
  }

  #setProgress(jump = false) {
    const target = progressAngle(this.progress);
    if (jump || this.reducedMotion || target < this.#lit) {
      this.#lit = this.#litFrom = target;
      this.#litAt = performance.now();
      if (this.state === 'progress' && this.reducedMotion) this.#apply(this.#shown);
      return this.#tick();
    }
    this.#litFrom = this.#lit;
    this.#litAt = performance.now();
    this.#tick();
  }

  #tick() {
    if (!this.#raf && this.isConnected && this.#visible) this.#raf = requestAnimationFrame((t) => this.#frame(t));
  }

  /** @param {number} now */
  #frame(now) {
    this.#raf = 0;
    let frame = this.#resting();
    let busy = false;

    if (this.#once) {
      const p = this.#once;
      const t = Math.max(0, now - p.start); // a frame's timestamp can precede the call that started it
      frame = sample(p.tl, t);
      this.#beats(p, t);
      if (t >= p.tl.duration) {
        this.#once = null;
        p.resolve?.();
        this.dispatchEvent(new CustomEvent('motionend', { detail: { motion: p.tl.name } }));
        this.#startBlend(now);
      }
      busy = true;
    } else if (this.#loop) {
      const t = Math.max(0, now - this.#loop.start);
      frame = sample(this.#loop.tl, t);
      this.#beats(this.#loop, t);
      busy = true;
    }

    if (this.state === 'progress') busy = this.#advanceLit(now) || busy;
    this.#extra = this.#extra.filter((e) => now - e.start < e.hit.attack + e.hit.decay);
    if (this.#extra.length) busy = true;

    if (this.#blend) {
      const k = Math.min(1, (now - this.#blend.start) / BLEND);
      frame = mix(this.#blend.from, frame, bezier(EASE.settle, k));
      if (k >= 1) this.#blend = null;
      busy = true;
    }
    this.#apply(frame, now);
    if (busy) this.#tick();
  }

  /** The still frame: at rest, except thinking under reduced motion, where the empty beat holds at 55 %. */
  #resting() {
    const f = restFrame();
    if (this.state === 'thinking' && this.reducedMotion) f.arcs[2].alpha = 0.55;
    return f;
  }

  /** Moves the lit sweep toward the target; a tick on each beat it completes, the landing at 100 %. */
  #advanceLit(now) {
    const target = progressAngle(this.progress);
    const k = Math.min(1, (now - this.#litAt) / LIT_TIME);
    const next = this.#litFrom + (target - this.#litFrom) * bezier(EASE.strike, k);
    if (!this.reducedMotion) {
      for (let b = 1; b < BEAT_ANGLES.length; b++) {
        if (this.#lit < BEAT_ANGLES[b] - 1e-6 && next >= BEAT_ANGLES[b] - 1e-6) {
          const info = THEKA[b - 1];
          const landing = b === BEAT_ANGLES.length - 1;
          if (!this.#small) this.#extra.push(landing ? { arc: SAM, start: now, hit: HIT.landing } : { arc: info.arc, start: now, hit: HIT.tick });
          this.dispatchEvent(new CustomEvent('beat', { detail: { ...info, landing: false } }));
          if (landing) {
            this.dispatchEvent(new CustomEvent('beat', { detail: { ...THEKA[0], landing: true } }));
            this.dispatchEvent(new CustomEvent('sam'));
          }
        }
      }
    }
    this.#lit = next;
    return k < 1;
  }

  /** Fires beat events for the beats crossed since the last frame. @param {Playing} p @param {number} t */
  #beats(p, t) {
    const { tl } = p;
    const time = tl.loop ? t % tl.duration : Math.min(t, tl.duration);
    const wrapped = tl.loop && time < p.last;
    for (const b of tl.beats) {
      const crossed = wrapped ? b.t > p.last || b.t <= time : b.t > p.last && b.t <= time;
      if (!crossed) continue;
      this.dispatchEvent(new CustomEvent('beat', { detail: { matra: b.matra, bol: b.bol, sign: b.sign, arc: b.arc, landing: !!b.landing } }));
      if (b.landing) this.dispatchEvent(new CustomEvent('sam'));
    }
    p.last = time;
  }

  #shouldAutoplay() {
    if (this.getAttribute('autoplay') !== 'session') return true;
    try {
      if (sessionStorage.getItem('taalcut.mark.played')) return false;
      sessionStorage.setItem('taalcut.mark.played', '1');
    } catch {
      /* storage blocked: play it */
    }
    return true;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('taalcut-mark')) {
  customElements.define('taalcut-mark', TaalcutMarkElement);
}

