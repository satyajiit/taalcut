// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Types of fixtures.mjs, the earshot parity fixtures loader (EAR1-F2). */

export type ClipCategory = 'music' | 'sfx' | 'speech' | 'edge' | 'texture' | 'mix' | 'film';

/** A plant in a fixture film: what answers cut `cut` at time `t` (s). offsetMs is null for a cut left silent. */
export interface FilmPlant {
  readonly cut: number;
  readonly frame: number;
  readonly t: number;
  readonly plant:
    'on' | 'late20' | 'late60' | 'late120' | 'late180' | 'early80' | 'swell' | 'swell200' | 'none';
  readonly kind: 'hit' | 'swell' | 'none';
  readonly offsetMs: number | null;
  readonly sound?: string;
  /** Planted attack (hit) or loudest moment (swell), in seconds. */
  readonly eventS?: number;
}

export interface ClipRow {
  readonly id: string;
  readonly category: ClipCategory;
  readonly kind: string;
  /** The file name upstream analysed (`<id>.wav`, in its working folder). */
  readonly file: string;
  /** For committed clips (the SFX renders): the path under fixtures/. */
  readonly committed?: string;
  /** Films: the picture's file name (`<id>.mp4`), made by writeFilmVideo. */
  readonly video?: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly samples: number;
  readonly seconds: number;
  readonly source: 'generated' | 'earshot sfx render';
  readonly format: 'f32' | 's16';
  readonly params: Readonly<Record<string, unknown>>;
  /** Planted ground truth: tempo, key, beats (music), phrases (speech), cuts and plants (films), ... */
  readonly truth: Readonly<Record<string, unknown>> & {
    readonly plants?: readonly FilmPlant[];
    readonly cuts?: readonly number[];
  };
}

export interface Manifest {
  readonly schema: 1;
  readonly upstream: {
    readonly repository: string;
    readonly commit: string;
    readonly version: string;
    readonly licence: string;
    readonly bank: string;
  };
  readonly models: Readonly<
    Record<
      'clap' | 'ast',
      {
        readonly id: string;
        readonly revision: string;
        readonly weights: string;
        readonly weightsSha256: string;
        readonly precision: string;
        readonly dtype: string;
      }
    >
  >;
  readonly settings: Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, string | number>>;
  readonly queries: readonly string[];
  readonly borderline: Readonly<
    Record<string, readonly { readonly term: string; readonly z: number; readonly threshold: number }[]>
  >;
  readonly clips: readonly ClipRow[];
  readonly files: Readonly<Record<string, { readonly sha256: string; readonly bytes: number }>>;
  readonly totalBytes: number;
}

export interface LoadedClip {
  readonly id: string;
  readonly sampleRate: number;
  /** Planar float32 channels as upstream decoded them. */
  readonly channels: readonly Float32Array[];
  readonly truth: ClipRow['truth'];
  readonly row: ClipRow;
}

export interface CliRun<R = Record<string, unknown>> {
  /** The `earshot` command line, run with --json from the clips folder. */
  readonly argv: readonly string[];
  readonly exit: number;
  readonly result: R;
}

export interface BlobInfo {
  readonly group: string;
  readonly file: string;
  /** Offset in float32 values from the start of the group's file. */
  readonly offset: number;
  readonly shape: readonly number[];
  readonly sha256: string;
  readonly [meta: string]: unknown;
}

export const PARITY_DIR: string;
export const FIXTURES_DIR: string;
export function manifest(): Manifest;
export function fixtureBytes(rel: string): Buffer;
export function fixtureJson<T = unknown>(rel: string): T;
export function clips(category?: ClipCategory): readonly ClipRow[];
export function clip(id: string): ClipRow;
export function clipWavBytes(id: string): Buffer;
export function loadClip(id: string): LoadedClip;
/** earshot's audio.to_mono of the stereo decode: (L + R) / 2. */
export function mono(loaded: LoadedClip): Float32Array;
/** earshot's audio.load(mono=True): FFmpeg's -ac 1 downmix, (L + R) * sqrt(1/2) for a stereo file. */
export function ffmpegMono(loaded: LoadedClip): Float32Array;
export function writeClip(id: string, dir: string): string;
export function writeFilmVideo(id: string, dir: string, ffmpeg?: string): Promise<string>;
export function cli<R = Record<string, unknown>>(command: string): Readonly<Record<string, CliRun<R>>>;
export function cliRun<R = Record<string, unknown>>(command: string, runId: string): R;
export function intermediate<T = Record<string, unknown>>(name: string): T;
export function blobIndex(): Readonly<Record<string, BlobInfo>>;
export function blob(key: string): {
  readonly data: Float32Array;
  readonly shape: readonly number[];
  readonly info: BlobInfo;
};
export function blobRows(key: string): Float32Array[];
export function kit(preset: 'calm' | 'crisp' | 'minimal' | 'launch'): {
  readonly kit: Record<string, unknown>;
  readonly lock: Record<string, unknown>;
};
