// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the synthesised `sfx-pack`'s sounds are made (the sounds themselves are listed in sfx-sounds.mjs): one
 * builder per category the hit planner places (core SFX_CATEGORIES: whoosh, riser, impact, hit), each turning a
 * few numbers into an FFmpeg filter graph over FFmpeg's own generators (seeded noise, expression oscillators) and
 * filters, so there is no third-party recording in them and Taalcut's contributors can dedicate them to the
 * public domain (CC0 1.0). A recipe's graph ends in `[out]`; a sweep is a list of filter commands every 10 ms
 * (`asendcmd`), written to a file the graph names.
 *
 *   whoosh  band-passed noise swelling to its peak while the band sweeps up and back (the peak lands on the cut)
 *   riser   an exponential chirp and rising high-passed noise, loudest at the very end (the end lands on the cut)
 *   impact  a pitch-dropping sine thump with a noise transient, some with an echo tail
 *   hit     short ticks, clicks, taps and claps for hard cuts
 */

const RATE = 48_000;
const STEP = 0.01;
const n = (value, digits = 5) => Number(value.toFixed(digits)).toString();

function noise({ color = 'white', seed, seconds, amplitude }) {
  return `anoisesrc=color=${color}:seed=${seed}:duration=${n(seconds)}:sample_rate=${RATE}:amplitude=${n(amplitude)}`;
}

function tone(expr, seconds) {
  return `aevalsrc=exprs='${expr}':s=${RATE}:d=${n(seconds)}`;
}

/** A per-sample-ish gain curve: frames of `samples` samples, the expression evaluated once a frame. */
function envelope(expr, samples = 64) {
  return `asetnsamples=n=${samples},volume=volume='${expr}':eval=frame`;
}

/** One chain, or several mixed at unity gain, then the tail filters, into [out]. */
function graph(chains, tail) {
  if (chains.length === 1) return `${chains[0]},${tail}[out]`;
  const labelled = chains.map((chain, i) => `${chain}[a${i}]`).join(';');
  const inputs = chains.map((_, i) => `[a${i}]`).join('');
  return `${labelled};${inputs}amix=inputs=${chains.length}:normalize=0:duration=longest,${tail}[out]`;
}

/** Filter commands every 10 ms: `frequencyAt(t)` for the named filter's `f`. */
function sweep(target, seconds, frequencyAt) {
  const lines = [];
  for (let i = 0; i * STEP <= seconds + 1e-9; i++) {
    const t = i * STEP;
    lines.push(`${n(t, 3)} ${target} f ${Math.round(frequencyAt(t))};`);
  }
  return `${lines.join('\n')}\n`;
}

export function whoosh(id, title, p) {
  const bell = (t, width) => Math.exp(-(((t - p.peak) / width) ** 2));
  return {
    id,
    title,
    category: 'whoosh',
    seconds: p.seconds,
    commands: sweep('bandpass@bp', p.seconds, (t) => p.low * (p.high / p.low) ** bell(t, p.width * 1.5)),
    graph: (commandFile) =>
      graph(
        [
          [
            noise({ color: p.color, seed: p.seed, seconds: p.seconds, amplitude: 0.8 }),
            `asendcmd=f=${commandFile}`,
            `bandpass@bp=f=${p.low}:width_type=q:w=${n(p.q)}`,
            envelope(`exp(-pow((t-${n(p.peak)})/${n(p.width)},2))`),
            ...(p.flanger ? ['flanger=delay=2:depth=4:speed=0.8'] : []),
          ].join(','),
        ],
        `afade=t=in:d=0.01,afade=t=out:st=${n(p.seconds - 0.03)}:d=0.03`,
      ),
  };
}

/** sin of an exponential chirp from f0 to f1 over the sound. */
function chirp(f0, f1, seconds, amplitude, harmonic = 0) {
  const k = Math.log(f1 / f0);
  const phase = `${n((2 * Math.PI * f0 * seconds) / k)}*(exp(${n(k / seconds)}*t)-1)`;
  const octave = harmonic > 0 ? `+${n(amplitude * harmonic)}*sin(2*${phase})` : '';
  return `${n(amplitude)}*sin(${phase})${octave}`;
}

export function riser(id, title, p) {
  const tremolo = p.tremolo
    ? `*(0.65+0.35*sin(2*PI*(${n(p.tremolo[0])}*t+${n((p.tremolo[1] - p.tremolo[0]) / (2 * p.seconds))}*t*t)))`
    : '';
  const chains = [];
  if (p.tone > 0)
    chains.push(tone(`(${chirp(p.f0, p.f1, p.seconds, p.tone, p.octave ?? 0)})${tremolo}`, p.seconds));
  chains.push(
    [
      noise({ color: p.color ?? 'white', seed: p.seed, seconds: p.seconds, amplitude: p.noise }),
      'asendcmd=f=COMMANDS',
      `highpass@hp=f=${p.hp[0]}`,
    ].join(','),
  );
  return {
    id,
    title,
    category: 'riser',
    seconds: p.seconds,
    commands: sweep('highpass@hp', p.seconds, (t) => p.hp[0] * (p.hp[1] / p.hp[0]) ** (t / p.seconds)),
    graph: (commandFile) =>
      graph(
        chains.map((chain) => chain.replace('COMMANDS', commandFile)),
        `${envelope(`pow(t/${n(p.seconds)},2.2)`)},afade=t=out:st=${n(p.seconds - 0.015)}:d=0.015`,
      ),
  };
}

/** A sine whose pitch falls from f0 to f1 (time constant `drop`), decaying, with a 2 ms attack. */
function thump(f0, f1, drop, decay, seconds) {
  return tone(
    `sin(2*PI*(${n(f1)}*t+${n((f0 - f1) * drop)}*(1-exp(-t/${n(drop)}))))*exp(-t/${n(decay)})*min(1,t/0.002)`,
    seconds,
  );
}

function burst(p, seconds) {
  return [
    noise({ color: p.color ?? 'white', seed: p.seed, seconds, amplitude: p.amplitude }),
    p.filter,
    envelope(p.envelope, 16),
  ].join(',');
}

export function impact(id, title, p) {
  return {
    id,
    title,
    category: 'impact',
    seconds: p.seconds,
    commands: null,
    graph: () =>
      graph(
        [
          thump(p.f0, p.f1, p.drop, p.decay, p.seconds),
          burst(
            {
              seed: p.seed,
              amplitude: p.noise,
              filter: `lowpass=f=${p.lowpass}`,
              envelope: `exp(-t/${n(p.noiseDecay)})`,
            },
            p.seconds,
          ),
        ],
        [...(p.echo ? [p.echo] : []), `afade=t=out:st=${n(p.seconds - 0.05)}:d=0.05`].join(','),
      ),
  };
}

export function hit(id, title, p) {
  const chains = [];
  if (p.tone) chains.push(tone(p.tone, p.seconds));
  if (p.burst) chains.push(burst(p.burst, p.seconds));
  return {
    id,
    title,
    category: 'hit',
    seconds: p.seconds,
    commands: null,
    graph: () => graph(chains, `afade=t=out:st=${n(p.seconds - 0.01)}:d=0.01`),
  };
}
