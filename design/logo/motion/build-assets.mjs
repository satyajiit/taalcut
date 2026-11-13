// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Builds the logo motion assets from choreography.js and mark-geometry.js:
//
//   diagrams/*.svg      timing diagrams for the spec (beat grid, theka, every arc's envelope)
//   storyboards/*.svg   key frames of each motion, on the dark canvas
//   export/*.svg        self-playing animated SVGs (CSS keyframes compiled from the timelines)
//   export/video/*      stings: MP4 in 16:9, 1:1 and 9:16, and a 16:9 MOV with alpha
//
//   node design/logo/motion/build-assets.mjs            everything
//   node design/logo/motion/build-assets.mjs --no-video skip the stings
//
// The stings need python3 with cairosvg (frames) and ffmpeg (encoding).

import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SYMBOL, LOCKUP, BISECTORS } from './mark-geometry.js';
import {
  EASE, HIT, BEAT_ANGLES, GROUP_STARTS, THEKA, MATRA, KHALI, SAM,
  countIn, tihai, keepTime, thinking, sample, sampleChannel, progressAngle, hitAt, bezier, restFrame,
} from './choreography.js';

const here = dirname(fileURLToPath(import.meta.url));
const VIDEO = !process.argv.includes('--no-video');

// The kit's colours (design/logo/kit/README.md §4).
const DARK = { bg: '#15110D', arcs: ['#FAAB3F', '#F26A90', '#9E8CF4', '#3CC2B4'], ink: '#F0ECE7' };
const LIGHT = { bg: '#FAF6F1', arcs: ['#A94E00', '#B02B57', '#6347B8', '#056965'], ink: '#1E1712' };
const UI = { paper: '#F6F2EC', panel: '#FFFFFF', rule: '#E2DACF', grid: '#EDE6DC', ink: '#1E1712', ink2: '#5B5148', ink3: '#857A70' };
const FONT = 'Onest, Helvetica Neue, Helvetica, Arial, sans-serif';
const MONO = 'JetBrains Mono, SF Mono, Menlo, monospace';
const ARC_NAMES = ['Beat one (sam)', 'Clap', 'Empty beat (khali)', 'Clap'];

const n = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (x, y, s, { size = 14, fill = UI.ink, weight = 400, anchor = 'start', font = FONT, opacity = 1 } = {}) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
const out = (rel, content) => {
  const p = join(here, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return rel;
};

// ---------- drawing a frame ----------

/** A sampled frame as SVG markup, in the geometry's own coordinates. */
function frameMarkup(frame, { geo = SYMBOL, colours = DARK, shape = 'reversed', lit = null } = {}) {
  const parts = [];
  frame.arcs.forEach((a, i) => {
    const r = (BISECTORS[i] * Math.PI) / 180;
    const t = a.push ? ` transform="translate(${n(a.push * Math.cos(r))} ${n(a.push * Math.sin(r))})"` : '';
    const o = a.alpha < 0.999 ? ` opacity="${n(a.alpha)}"` : '';
    const d = geo.arcs[shape][i];
    if (lit === null) parts.push(`<g${t}${o}><path fill="${colours.arcs[i]}" d="${d}"/></g>`);
    else {
      parts.push(`<g${t}${o}><path fill="${colours.arcs[i]}" opacity="0.22" d="${d}"/>` +
        `<path fill="${colours.arcs[i]}" d="${d}" clip-path="url(#lit)"/></g>`);
    }
  });
  if (geo === LOCKUP) {
    const w = frame.word;
    parts.push(`<g${w.shift ? ` transform="translate(${n(w.shift)} 0)"` : ''} opacity="${n(w.alpha)}"><path fill="${colours.ink}" fill-rule="evenodd" d="${LOCKUP.wordmark}"/></g>`);
  }
  let defs = '';
  if (lit !== null) defs = `<defs><clipPath id="lit"><path d="${wedge(geo.cx, geo.cy, lit)}"/></clipPath></defs>`;
  return defs + parts.join('');
}

function wedge(cx, cy, deg, R = 160) {
  if (deg >= 359.999) return `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`;
  if (deg <= 0) return 'M0 0Z';
  const a = ((deg - 90) * Math.PI) / 180;
  return `M${cx} ${cy}L${cx} ${cy - R}A${R} ${R} 0 ${deg > 180 ? 1 : 0} 1 ${n(cx + R * Math.cos(a))} ${n(cy + R * Math.sin(a))}Z`;
}

// ---------- progress, simulated the way the component plays it ----------

/** A render going from 0 to 100 % linearly over `ms`; returns a sampler of frames and lit angle. */
function progressRun(ms = 5000) {
  const ticks = [];
  for (let b = 1; b < BEAT_ANGLES.length; b++) {
    const t = ((b / 10) * ms);
    ticks.push(b === 10 ? { t, arc: SAM, hit: HIT.landing } : { t, arc: THEKA[b - 1].arc, hit: HIT.tick });
  }
  const at = (t) => {
    const f = restFrame();
    for (const k of ticks) f.arcs[k.arc].push += hitAt(t - k.t, k.hit);
    return { frame: f, lit: progressAngle(Math.min(1, t / ms)) };
  };
  return { ms, ticks, at, duration: ms + HIT.landing.attack + HIT.landing.decay };
}

// ---------- timing diagrams ----------

function diagram({ title, sub, tl, matra, lanes, header, file, simulate = null, width = 1200 }) {
  const L = 250, R = 24, top = 92;
  const plotW = width - L - R;
  const duration = simulate ? simulate.duration : tl.duration;
  const x = (t) => L + (t / duration) * plotW;
  const laneH = 58, headH = header ? 66 : 26;
  const h = top + headH + lanes.length * laneH + 46;
  const p = [`<rect width="${width}" height="${h}" fill="${UI.paper}"/>`,
    `<rect x="12" y="12" width="${width - 24}" height="${h - 24}" rx="14" fill="${UI.panel}" stroke="${UI.rule}"/>`,
    text(L, 48, title, { size: 20, weight: 600 }),
    text(L, 72, sub, { size: 14, fill: UI.ink2 })];
  // beat grid
  const beats = Math.round(duration / matra) + 1;
  for (let b = 0; b <= beats; b++) {
    const t = b * matra;
    if (t > duration + 1) break;
    p.push(`<line x1="${n(x(t))}" y1="${top}" x2="${n(x(t))}" y2="${h - 40}" stroke="${UI.grid}"/>`);
  }
  // header rows (theka or phrase labels)
  if (header) {
    header.forEach((cell) => {
      const cx = x(cell.t) + 4;
      p.push(text(cx, top + 16, cell.top, { size: 12, fill: UI.ink3, font: MONO }));
      p.push(text(cx, top + 36, cell.mid, { size: 15, weight: 500 }));
      if (cell.bottom) p.push(text(cx, top + 56, cell.bottom, { size: 12, fill: UI.ink3, font: MONO }));
    });
  }
  // lanes
  lanes.forEach((lane, li) => {
    const y0 = top + headH + li * laneH;
    const base = y0 + laneH - 14;
    p.push(`<line x1="${L}" y1="${base}" x2="${width - R}" y2="${base}" stroke="${UI.rule}"/>`);
    p.push(`<rect x="28" y="${y0 + 14}" width="10" height="10" rx="2" fill="${lane.colour}"/>`);
    p.push(text(46, y0 + 24, lane.name, { size: 14, weight: 500 }));
    if (lane.note) p.push(text(46, y0 + 42, lane.note, { size: 12, fill: UI.ink3 }));
    const pts = [], apts = [];
    for (let t = 0; t <= duration; t += 2) {
      const f = simulate ? simulate.at(t).frame : sample(tl, t);
      const v = lane.word ? f.word : f.arcs[lane.arc];
      // visible movement only: an arc parked off its place while still invisible is not drawn
      const push = (lane.word ? (Math.abs(v.shift) / 10) * 12 : v.push) * Math.min(1, v.alpha);
      pts.push(`${n(x(t))},${n(base - push * 3)}`);
      apts.push(`${n(x(t))},${n(base - v.alpha * 36)}`);
    }
    p.push(`<polygon points="${n(x(0))},${base} ${pts.join(' ')} ${n(x(duration))},${base}" fill="${lane.colour}" opacity="0.9"/>`);
    p.push(`<polyline points="${apts.join(' ')}" fill="none" stroke="${lane.colour}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"/>`);
  });
  // time axis
  const step = duration > 3000 ? 1000 : duration > 1200 ? 250 : 100;
  for (let t = 0; t <= duration + 1; t += step) p.push(text(x(t), h - 22, `${t} ms`, { size: 11, fill: UI.ink3, font: MONO, anchor: 'middle' }));
  // legend
  p.push(`<rect x="${width - R - 330}" y="38" width="22" height="10" fill="${UI.ink2}" opacity="0.9"/>`);
  p.push(text(width - R - 302, 48, 'push (radial, filled)', { size: 12, fill: UI.ink2 }));
  p.push(`<line x1="${width - R - 160}" y1="43" x2="${width - R - 138}" y2="43" stroke="${UI.ink2}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
  p.push(text(width - R - 132, 48, 'opacity (dashed)', { size: 12, fill: UI.ink2 }));
  return out(`diagrams/${file}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">${p.join('')}</svg>\n`);
}

const arcLanes = (notes = []) => [0, 1, 2, 3].map((i) => ({ arc: i, colour: LIGHT.arcs[i], name: ARC_NAMES[i], note: notes[i] }));
const thekaHeader = (m, cycles = 1, landing = true) => {
  const cells = [];
  for (let c = 0; c < cycles; c++) THEKA.forEach((b, i) => cells.push({ t: (c * 10 + i) * m, top: String(b.matra), mid: b.bol, bottom: b.sign }));
  if (landing) cells.push({ t: cycles * 10 * m, top: '1', mid: 'dhi', bottom: 'X' });
  return cells;
};

// ---------- storyboards ----------

function storyboard({ file, frames, geo = SYMBOL, title }) {
  const cell = geo === LOCKUP ? 300 : 168, gap = 12, pad = 24;
  const cw = geo === LOCKUP ? 300 : 168;
  const ch = geo === LOCKUP ? 120 : 168;
  const cols = Math.min(frames.length, geo === LOCKUP ? 4 : 8);
  const rows = Math.ceil(frames.length / cols);
  const W = pad * 2 + cols * cw + (cols - 1) * gap;
  const H = 64 + rows * (ch + 56) + pad;
  const p = [`<rect width="${W}" height="${H}" fill="${UI.paper}"/>`, text(pad, 40, title, { size: 18, weight: 600 })];
  frames.forEach((fr, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = 60 + Math.floor(i / cols) * (ch + 56);
    const s = Math.min(cw / geo.width, ch / geo.height) * 0.86;
    const ox = x + (cw - geo.width * s) / 2, oy = y + (ch - geo.height * s) / 2;
    const id = `c${i}`;
    let inner = frameMarkup(fr.frame, { geo, lit: fr.lit ?? null });
    inner = inner.replace(/url\(#lit\)/g, `url(#lit${id})`).replace('<clipPath id="lit">', `<clipPath id="lit${id}">`);
    p.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="${DARK.bg}"/>`);
    p.push(`<g transform="translate(${n(ox)} ${n(oy)}) scale(${n(s)})">${inner}</g>`);
    p.push(text(x + 2, y + ch + 20, fr.label, { size: 13, weight: 500 }));
    p.push(text(x + 2, y + ch + 38, fr.time, { size: 12, fill: UI.ink3, font: MONO }));
  });
  void cell;
  return out(`storyboards/${file}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${p.join('')}</svg>\n`);
}

// ---------- animated SVG: timelines compiled to CSS keyframes ----------

const cb = (e) => `cubic-bezier(${e.join(', ')})`;

function keyframesCss(name, keys, initial, duration, toValue) {
  const pts = [];
  const pct = (t) => `${n((t / duration) * 100)}%`;
  if (!keys.length || keys[0].t > 0) pts.push({ at: '0%', v: initial, ease: EASE.linear });
  for (const k of keys) pts.push({ at: pct(k.t), v: k.v, ease: k.ease });
  const last = keys.length ? keys[keys.length - 1].v : initial;
  pts.push({ at: '100%', v: last, ease: EASE.linear });
  return `@keyframes ${name}{${pts.map((q) => `${q.at}{${toValue(q.v)};animation-timing-function:${cb(q.ease)}}`).join('')}}`;
}

function animatedSvg({ tl, geo, file, title }) {
  const css = [];
  const els = [];
  const dur = `${tl.duration}ms`;
  for (let i = 0; i < 4; i++) {
    const r = (BISECTORS[i] * Math.PI) / 180;
    const anims = [];
    const pushKeys = tl.channels[`arc${i}.push`];
    if (pushKeys) {
      css.push(keyframesCss(`p${i}`, pushKeys, tl.initial[`arc${i}.push`], tl.duration,
        (v) => `transform:translate(${n(v * Math.cos(r))}px,${n(v * Math.sin(r))}px)`));
      anims.push(`p${i} ${dur} both`);
    }
    const alphaKeys = tl.channels[`arc${i}.alpha`];
    if (alphaKeys) {
      css.push(keyframesCss(`o${i}`, alphaKeys, tl.initial[`arc${i}.alpha`], tl.duration, (v) => `opacity:${n(v)}`));
      anims.push(`o${i} ${dur} both`);
    }
    if (anims.length) css.push(`.a${i}{animation:${anims.join(',')}}`);
    els.push(`<g class="a${i}"><path class="c${i}" d="${geo.arcs.standard[i]}"/></g>`);
  }
  if (geo === LOCKUP) {
    css.push(keyframesCss('wo', tl.channels['word.alpha'], tl.initial['word.alpha'], tl.duration, (v) => `opacity:${n(v)}`));
    css.push(keyframesCss('ws', tl.channels['word.shift'], tl.initial['word.shift'], tl.duration, (v) => `transform:translateX(${n(v)}px)`));
    css.push(`.w{animation:wo ${dur} both,ws ${dur} both}`);
    els.push(`<g class="w"><path class="ink" fill-rule="evenodd" d="${LOCKUP.wordmark}"/></g>`);
  }
  const colours = (c) => c.arcs.map((hex, i) => `.c${i}{fill:${hex}}`).join('') + `.ink{fill:${c.ink}}`;
  const style = [
    colours(LIGHT),
    `@media (prefers-color-scheme:dark){${colours(DARK)}}`,
    ...css,
    '@media (prefers-reduced-motion:reduce){.a0,.a1,.a2,.a3,.w{animation:none}}',
  ].join('\n');
  return out(`export/${file}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${geo.width} ${geo.height}" width="${geo.width}" height="${geo.height}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
<style>
${style}
</style>
${els.join('\n')}
</svg>
`);
}

// ---------- video stings ----------

function stings() {
  const fps = 60, lead = 300, hold = 1600;
  const tl = countIn({ lockup: true });
  const total = lead + tl.duration + hold;
  const frames = Math.ceil((total / 1000) * fps);
  const formats = [
    { name: '16x9', w: 1920, h: 1080, frac: 0.56 },
    { name: '1x1', w: 1080, h: 1080, frac: 0.74 },
    { name: '9x16', w: 1080, h: 1920, frac: 0.8 },
  ];
  const tmp = mkdtempSync(join(tmpdir(), 'taalcut-sting-'));
  const made = [];
  try {
    for (const f of formats) {
      const dir = join(tmp, f.name);
      const alphaDir = join(tmp, `${f.name}-alpha`);
      mkdirSync(dir, { recursive: true });
      const alpha = f.name === '16x9';
      if (alpha) mkdirSync(alphaDir, { recursive: true });
      const vw = LOCKUP.width / f.frac;
      const vh = (vw * f.h) / f.w;
      const vx = -(vw - LOCKUP.width) / 2, vy = -(vh - LOCKUP.height) / 2;
      for (let i = 0; i < frames; i++) {
        const t = (i / fps) * 1000 - lead;
        const fr = sample(tl, t);
        const body = frameMarkup(fr, { geo: LOCKUP, colours: DARK, shape: 'reversed' });
        const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="${f.w}" height="${f.h}">`;
        writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.svg`), `${head}<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="${DARK.bg}"/>${body}</svg>`);
        if (alpha) writeFileSync(join(alphaDir, `f${String(i).padStart(4, '0')}.svg`), `${head}${body}</svg>`);
      }
      const dirs = alpha ? [dir, alphaDir] : [dir];
      execFileSync('python3', ['-c', `
import sys, os, cairosvg
w, h = int(sys.argv[1]), int(sys.argv[2])
for d in sys.argv[3:]:
    for name in sorted(os.listdir(d)):
        if name.endswith('.svg'):
            cairosvg.svg2png(url=os.path.join(d, name), write_to=os.path.join(d, name[:-4] + '.png'), output_width=w, output_height=h)
`, String(f.w), String(f.h), ...dirs], { stdio: 'inherit' });
      const mp4 = join(here, 'export', 'video', `taalcut-count-in-${f.name}.mp4`);
      mkdirSync(dirname(mp4), { recursive: true });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'slow', '-movflags', '+faststart', mp4]);
      made.push(mp4);
      if (alpha) {
        const mov = join(here, 'export', 'video', `taalcut-count-in-${f.name}-alpha.mov`);
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(alphaDir, 'f%04d.png'),
          '-c:v', 'qtrle', '-pix_fmt', 'argb', mov]);
        made.push(mov);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return made;
}

// ---------- build ----------

const files = [];
const ci = countIn({ lockup: true });
files.push(diagram({
  title: 'Count-in', sub: `One cycle of jhaptaal at ${MATRA.countIn} ms a beat: arcs arrive on beats 1, 3, 6 and 8; beat eleven is beat one again, the landing.`,
  tl: ci, matra: MATRA.countIn, file: 'count-in', header: thekaHeader(MATRA.countIn),
  lanes: [...arcLanes(['arrives on beat 1, lands on beat 11', 'arrives on beat 3', 'fades in on beat 6, no drop', 'arrives on beat 8']),
    { word: true, colour: LIGHT.ink, name: 'Wordmark', note: 'enters on the landing (lockup)' }],
}));
const th = tihai();
const thHeader = [];
for (let p = 0; p < 3; p++) ['clap', 'wave', 'clap'].forEach((m, j) => thHeader.push({ t: (p * 4 + j) * MATRA.tihai, top: j === 0 ? `phrase ${p + 1}` : '', mid: m, bottom: j === 0 ? ['60 %', '80 %', '100 %'][p] : '' }));
thHeader.push({ t: 11 * MATRA.tihai, top: 'sam', mid: 'land', bottom: 'X' });
files.push(diagram({
  title: 'Tihai', sub: `A phrase (clap, wave, clap) played three times with a crescendo, then the landing on beat one. ${MATRA.tihai} ms a beat.`,
  tl: th, matra: MATRA.tihai, file: 'tihai', header: thHeader, lanes: arcLanes(['the landing', 'phrase stroke 1', 'phrase stroke 2: the wave', 'phrase stroke 3']),
}));
const kt = keepTime({ bpm: 120 });
files.push(diagram({
  title: 'Keep time (120 BPM)', sub: 'Loops while work of unknown length runs. Claps on beats 1, 3 and 8, the wave on beat 6, at the reference reel’s tempo.',
  tl: kt, matra: 500, file: 'keep-time', header: thekaHeader(500, 1, false), lanes: arcLanes(['sam stroke', 'clap', 'wave over two beats', 'clap']),
}));
const tk = thinking();
files.push(diagram({
  title: 'Thinking', sub: 'Loops while the agent works. Only the empty beat moves: it is the violet arc, the colour of the agent.',
  tl: tk, matra: MATRA.thinking, file: 'thinking', header: null, lanes: arcLanes(['still', 'still', 'dims to 45 % and returns', 'still']),
}));
const pr = progressRun(5000);
files.push(diagram({
  title: 'Progress (a 5 s render)', sub: 'Each tenth of the work lights one beat and ticks its arc as it completes; the tenth beat completes the cycle, so beat one lands.',
  tl: kt, simulate: pr, matra: 500, file: 'progress',
  // each beat is labelled inside its span; its tick fires when the span completes
  header: [...THEKA.map((b, i) => ({ t: i * 500 + 150, top: String(b.matra), mid: b.bol, bottom: b.sign })), { t: 5000, top: '1', mid: 'dhi', bottom: 'X' }],
  lanes: arcLanes(['beats 1–2 tick; lands at 100 %', 'ticks as beats 3–5 complete', 'ticks as beats 6–7 complete', 'ticks as beats 8–9 complete']),
}));

const at = (tl, t) => sample(tl, t);
files.push(storyboard({
  file: 'count-in', geo: LOCKUP, title: 'Count-in (lockup), key frames',
  frames: [[0, 'Start: nothing'], [60, 'Beat 1: beat one drops in'], [300, 'Beat 3: the clap arrives'], [760, 'Beat 6: the empty beat fades in'],
    [960, 'Beat 8: the last clap'], [1250, 'Beat 11 = beat one'], [1340, 'The landing, wordmark enters'], [1860, 'Rest']]
    .map(([t, label]) => ({ frame: at(ci, t), label, time: `${t} ms` })),
}));
files.push(storyboard({
  file: 'tihai', title: 'Tihai, key frames',
  frames: [[70, 'Phrase 1: clap'], [180, 'wave'], [260, 'clap'], [450, 'Phrase 2: clap'], [830, 'Phrase 3: clap'], [1020, 'clap'], [1135, 'Landing on beat one'], [1655, 'Rest']]
    .map(([t, label]) => ({ frame: at(th, t), label, time: `${t} ms` })),
}));
files.push(storyboard({
  file: 'keep-time', title: 'Keep time at 120 BPM, key frames (loop)',
  frames: [[70, 'Beat 1: sam'], [600, 'between beats: still'], [1070, 'Beat 3: clap'], [2850, 'Beat 6: the wave, lowest'], [3570, 'Beat 8: clap'], [4600, 'Beat 10: still']]
    .map(([t, label]) => ({ frame: at(kt, t), label, time: `${t} ms` })),
}));
files.push(storyboard({
  file: 'thinking', title: 'Thinking, key frames (loop)',
  frames: [[0, 'Start'], [350, 'dimming'], [700, 'lowest (45 %)'], [1050, 'returning'], [1400, 'loop']]
    .map(([t, label]) => ({ frame: at(tk, t), label, time: `${t} ms` })),
}));
files.push(storyboard({
  file: 'progress', title: 'Progress, key frames (a 5 s render)',
  frames: [[0, '0 %'], [1250, '25 %'], [2500, '50 %'], [3540, 'Beat 8 completes: tick'], [4750, '95 %'], [5090, '100 %: landing'], [5610, 'Done']]
    .map(([t, label]) => { const s = pr.at(t); return { frame: s.frame, lit: s.lit, label, time: `${t} ms` }; }),
}));

files.push(animatedSvg({ tl: countIn({ lockup: true }), geo: LOCKUP, file: 'taalcut-count-in-lockup', title: 'Taalcut' }));
files.push(animatedSvg({ tl: countIn(), geo: SYMBOL, file: 'taalcut-count-in-symbol', title: 'Taalcut' }));
files.push(animatedSvg({ tl: tihai(), geo: SYMBOL, file: 'taalcut-tihai-symbol', title: 'Taalcut' }));

if (VIDEO) files.push(...stings().map((p) => p.replace(here + '/', '')));
console.log(`${files.length} motion assets:\n  ${files.join('\n  ')}`);
void bezier; void sampleChannel; void GROUP_STARTS; void KHALI;
