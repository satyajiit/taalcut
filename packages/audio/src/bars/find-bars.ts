// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the bars of a piece of music, measured from its samples, for carrying the music longer by playing bars
 * again. No model, on-device or cloud: the onset curve's autocorrelation gives the beat (pulse.ts), three or four
 * beats to the bar by which of the two the curve repeats at more strongly, and the bar's first beat by where the
 * low end hits and the sound changes most (as earshot's downbeat guess reads a kick and a change of harmony). Each
 * bar line is then put on the attack of the onset it sits at, so a splice can end just before it.
 *
 * Everything is a number with how sure it is: nothing here decides whether the music should repeat, or where. A
 * piece with no steady pulse is answered as that (`steady: false`, with why), and the caller refuses with it.
 */
import { median } from '../listen/dsp/stats';
import {
  beatFrames,
  beatLength,
  beatOffset,
  beatSeconds as beatTime,
  beatsWithOnset,
  likeness,
  multipleReach,
  near,
  standardise,
  type Likeness,
} from './pulse';
import {
  bandsApart,
  bandSpectrum,
  BARS_FRAME_SECONDS,
  BARS_HOP,
  BARS_SAMPLE_RATE,
  levelDb,
  meanBands,
  type BandSpectrum,
} from './spectrum';

/** Under this, the curve is not like itself a beat later: no pulse to count bars by (earshot's weak pulse). */
export const BARS_MIN_PULSE = 0.15;
/** Under this share of beats with an onset on them, the beat found does not hold through the piece. */
export const BARS_MIN_ON_BEAT = 0.5;
const MIN_SECONDS = 4;
/** By how much the curve must be more like itself three beats later than two or four, to count three to the bar. */
const METER_LEAD = 0.1;
/** A change is listed when it stands this many robust spreads over the piece's usual change from beat to beat. */
const CHANGE_SPREADS = 3;
const MAX_CHANGES = 12;

export interface MusicBar {
  /** The bar line, in seconds from the music's first sample. */
  readonly at: number;
  /** The bar's level, dBFS (RMS). */
  readonly levelDb: number;
  /** How far the bar's sound is from the bar before, in dB over the bands (0: the same sound); null for the first. */
  readonly fromBarBefore: number | null;
}

export interface MusicChange {
  /** The beat the music changes at, in seconds. */
  readonly at: number;
  /** The level of the beat after against the beat before, in dB. */
  readonly levelDb: number;
  /** How far the sound after is from the sound before, in dB over the bands. */
  readonly bandsDb: number;
}

export interface MusicBars {
  /** How much music was measured, in seconds. */
  readonly seconds: number;
  /** A steady pulse was found and the bars below can be counted on; false: `why`. */
  readonly steady: boolean;
  readonly why?: string;
  readonly bpm: number | null;
  readonly beatSeconds: number | null;
  readonly beatsPerBar: number | null;
  readonly barSeconds: number | null;
  /** How sure each part of the measurement is, 0 to 1. */
  readonly sure: {
    /** How like itself the onset curve is one beat later. */
    readonly pulse: number;
    /** The share of beats with an onset within 25 ms. */
    readonly onBeat: number;
    /** How like itself the curve is one bar later. */
    readonly bar: number;
    /** By how much the beats to the bar lead the other count (three against four). */
    readonly meter: number;
    /** By how much the bar's first beat leads the next most likely beat. */
    readonly firstBeat: number;
  };
  /** How many beats the beat's length was measured across (the more, the finer). */
  readonly measuredAcrossBeats: number;
  readonly bars: readonly MusicBar[];
  /** Where the music changes most from one beat to the next, in time order. */
  readonly changes: readonly MusicChange[];
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;
const tenth = (value: number) => Math.round(value * 10) / 10;
const hundredth = (value: number) => Math.round(value * 100) / 100;
const unit = (value: number) => hundredth(Math.max(0, Math.min(1, value)));

const NOT_SURE = { pulse: 0, onBeat: 0, bar: 0, meter: 0, firstBeat: 0 } as const;

function none(seconds: number, why: string, sure: MusicBars['sure'] = NOT_SURE): MusicBars {
  return {
    seconds: hundredth(seconds),
    steady: false,
    why,
    bpm: null,
    beatSeconds: null,
    beatsPerBar: null,
    barSeconds: null,
    sure,
    measuredAcrossBeats: 0,
    bars: [],
    changes: [],
  };
}

/**
 * How like itself the music is `beats` beats later, read apart in the low end, the middle and the top (a kick, a
 * snare and a hat are each their own curve, so a bar's pattern counts and not only that something hit); null when
 * the piece is too short to tell.
 */
function likeAt(parts: readonly Likeness[], beat: number, beats: number): number | null {
  const lag = beats * beat;
  if (parts.length === 0 || lag > (parts[0]?.longest ?? 0)) return null;
  const sum = parts.reduce((total, like) => total + like.peakNear(lag, multipleReach(beat)).value, 0);
  return sum / parts.length;
}

/** Each value in spreads from the values' mean; all zero when they don't differ. */
function spreads(values: readonly number[]): number[] {
  const m = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const spread = Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length),
  );
  return values.map((value) => (spread > 1e-9 ? (value - m) / spread : 0));
}

interface BeatFacts {
  readonly level: number;
  readonly apart: number;
}

/** Each beat against the beat before it: the level's step and how far the sound moved. */
function beatSteps(
  mono: Float32Array,
  spectrum: BandSpectrum,
  beats: readonly number[],
  beat: number,
): BeatFacts[] {
  return beats.map((at) => {
    const after = levelDb(mono, at * BARS_HOP, (at + beat) * BARS_HOP);
    const before = levelDb(mono, (at - beat) * BARS_HOP, at * BARS_HOP);
    const apart = bandsApart(meanBands(spectrum, at, at + beat), meanBands(spectrum, at - beat, at));
    return { level: after !== null && before !== null ? after - before : 0, apart: apart ?? 0 };
  });
}

/** The beats whose change stands out of the piece's usual change, at most twelve, in time order. */
function strongChanges(steps: readonly BeatFacts[], times: readonly number[]): MusicChange[] {
  const apart = steps.map((step) => step.apart);
  const middle = median(apart);
  const spread = 1.4826 * median(apart.map((value) => Math.abs(value - middle))) + 1e-6;
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step, index }) => index > 0 && step.apart >= middle + CHANGE_SPREADS * spread)
    .sort((a, b) => b.step.apart - a.step.apart)
    .slice(0, MAX_CHANGES)
    .sort((a, b) => a.index - b.index)
    .map(({ step, index }) => ({
      at: ms(times[index] ?? 0),
      levelDb: tenth(step.level),
      bandsDb: tenth(step.apart),
    }));
}

/** The bars of `mono` (48 kHz), measured from its samples. */
export function findMusicBars(mono: Float32Array): MusicBars {
  const seconds = mono.length / BARS_SAMPLE_RATE;
  if (seconds < MIN_SECONDS)
    return none(
      seconds,
      `The music is ${hundredth(seconds)} s long: under ${MIN_SECONDS} s holds too few beats.`,
    );
  const spectrum = bandSpectrum(mono);
  const curve = standardise(spectrum.rise);
  const like = likeness(curve);
  const beat = beatLength(like);
  if (!beat)
    return none(seconds, 'The music is too short to hold four beats of the slowest tempo read (60).');
  const offset = beatOffset(curve, beat.frames);
  const beats = beatFrames(curve, beat.frames, offset);
  const onBeat = beatsWithOnset(curve, beats);
  const low = standardise(spectrum.lowRise);
  const parts = [low, standardise(spectrum.midRise), standardise(spectrum.highRise)].map(likeness);
  const two = likeAt(parts, beat.frames, 2);
  const three = likeAt(parts, beat.frames, 3);
  const four = likeAt(parts, beat.frames, 4);
  const even = Math.max(two ?? 0, four ?? 0);
  // Three to the bar only when the curve says so clearly: a near tie reads as four, and `meter` says how near.
  const beatsPerBar = three !== null && three > even + METER_LEAD ? 3 : 4;
  const bar = likeAt(parts, beat.frames, beatsPerBar);
  const sureSoFar = {
    pulse: unit(beat.clarity),
    onBeat: unit(onBeat),
    bar: unit(bar ?? 0),
    meter: unit(Math.abs(even - (three ?? 0))),
    firstBeat: 0,
  };
  const bpm = 60 / (beat.frames * BARS_FRAME_SECONDS);
  if (beat.clarity < BARS_MIN_PULSE)
    return none(
      seconds,
      `No steady pulse: the music is ${hundredth(beat.clarity)} like itself one beat later ` +
        `(at ${tenth(bpm)} beats a minute), and bars are counted from ${BARS_MIN_PULSE}.`,
      sureSoFar,
    );
  if (onBeat < BARS_MIN_ON_BEAT)
    return none(
      seconds,
      `No steady pulse: ${Math.round(onBeat * 100)}% of the beats at ${tenth(bpm)} beats a minute have an onset ` +
        `on them, and bars are counted from ${Math.round(BARS_MIN_ON_BEAT * 100)}%.`,
      sureSoFar,
    );
  if (bar === null)
    return none(
      seconds,
      `The music is too short to hear a bar of ${beatsPerBar} beats come round again.`,
      sureSoFar,
    );

  // The bar's first beat: where the low end hits and the sound changes, counted over every bar.
  const steps = beatSteps(mono, spectrum, beats, beat.frames);
  const kick = spreads(beats.map((at) => near(low, at, 3)));
  const moved = spreads(steps.map((step) => step.apart));
  const weight = Array.from({ length: beatsPerBar }, (_, phase) => {
    const own = beats.flatMap((_at, index) =>
      index % beatsPerBar === phase ? [(kick[index] ?? 0) + (moved[index] ?? 0)] : [],
    );
    return own.length > 0 ? own.reduce((sum, value) => sum + value, 0) / own.length : -Infinity;
  });
  const first = weight.indexOf(Math.max(...weight));
  const others = weight.filter((_value, phase) => phase !== first);
  const lead = (weight[first] ?? 0) - Math.max(...others);
  const range = Math.max(...weight) - Math.min(...weight);

  const beatSeconds = beat.frames * BARS_FRAME_SECONDS;
  const times = beats.map((at) => beatTime(curve, at));
  const lines = times.filter((_time, index) => index % beatsPerBar === first);
  const barSeconds = beatSeconds * beatsPerBar;
  const sound = lines.map((at) =>
    meanBands(spectrum, at / BARS_FRAME_SECONDS, (at + barSeconds) / BARS_FRAME_SECONDS),
  );
  const bars = lines.map((at, index): MusicBar => {
    const apart = index > 0 ? bandsApart(sound[index] ?? null, sound[index - 1] ?? null) : null;
    return {
      at: ms(at),
      levelDb: tenth(levelDb(mono, at * BARS_SAMPLE_RATE, (at + barSeconds) * BARS_SAMPLE_RATE) ?? -120),
      fromBarBefore: apart === null ? null : tenth(apart),
    };
  });
  return {
    seconds: hundredth(seconds),
    steady: true,
    bpm: hundredth(bpm),
    beatSeconds: Math.round(beatSeconds * 1e5) / 1e5,
    beatsPerBar,
    barSeconds: Math.round(barSeconds * 1e5) / 1e5,
    sure: { ...sureSoFar, firstBeat: unit(range > 1e-9 ? lead / range : 0) },
    measuredAcrossBeats: beat.across,
    bars,
    changes: strongChanges(steps, times),
  };
}

export interface RepeatSeam {
  /**
   * How far the sound just before the splice is from the sound just before the point the music goes back to, in dB
   * over the bands: 0 is the same sound, so the bar played again follows what it followed the first time. Null
   * when the music would go back past its start.
   */
  readonly apartDb: number | null;
  /** The level just before the point it goes back to, against the level just before the splice, in dB. */
  readonly levelDb: number | null;
  /** The length compared on each side, in seconds. */
  readonly overSeconds: number;
}

/**
 * What the splice joins where the music goes back `back` seconds at `at`: the stretch before the splice against
 * the stretch that came before the music played again, read from the samples. Alike, the join is not heard.
 */
export function repeatSeam(mono: Float32Array, at: number, back: number, over = 0.25): RepeatSeam {
  if (at - back - over < 0) return { apartDb: null, levelDb: null, overSeconds: over };
  const spectrum = bandSpectrum(
    mono.subarray(0, Math.min(mono.length, Math.ceil((at + over) * BARS_SAMPLE_RATE))),
  );
  const frame = (seconds: number) => seconds / BARS_FRAME_SECONDS;
  const apart = bandsApart(
    meanBands(spectrum, frame(at - over), frame(at)),
    meanBands(spectrum, frame(at - back - over), frame(at - back)),
  );
  const sample = (seconds: number) => seconds * BARS_SAMPLE_RATE;
  const before = levelDb(mono, sample(at - over), sample(at));
  const earlier = levelDb(mono, sample(at - back - over), sample(at - back));
  return {
    apartDb: apart === null ? null : tenth(apart),
    levelDb: before === null || earlier === null ? null : tenth(earlier - before),
    overSeconds: over,
  };
}
