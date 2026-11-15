// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: where the length tools get the bars of a template's reel (tools/lengthen-tools.ts). The bars are measured
 * from the reel's audio samples by @taalcut/audio (`findMusicBars`: onset strength and its autocorrelation, no
 * model), which this package may not import; the composition root's port decodes the kept reel's sound and runs
 * it. The shapes here are that measurement's, as plain numbers in seconds of the reel.
 */
import type { AsyncResult, TemplateId } from '@taalcut/core';

export interface ReelBar {
  /** The bar line, in seconds of the reel's music. */
  readonly at: number;
  /** The bar's level, dBFS. */
  readonly levelDb: number;
  /** How far the bar's sound is from the bar before, in dB over the bands; null for the first. */
  readonly fromBarBefore: number | null;
}

export interface ReelChange {
  readonly at: number;
  readonly levelDb: number;
  readonly bandsDb: number;
}

export interface ReelBars {
  readonly seconds: number;
  /** False: no steady pulse was found, and `why` says so with the numbers. */
  readonly steady: boolean;
  readonly why?: string;
  readonly bpm: number | null;
  readonly beatSeconds: number | null;
  readonly beatsPerBar: number | null;
  readonly barSeconds: number | null;
  /** How sure each part of the measurement is, 0 to 1. */
  readonly sure: {
    readonly pulse: number;
    readonly onBeat: number;
    readonly bar: number;
    readonly meter: number;
    readonly firstBeat: number;
  };
  readonly measuredAcrossBeats: number;
  readonly bars: readonly ReelBar[];
  readonly changes: readonly ReelChange[];
}

/** What a splice joins: the sound before it against the sound before the point the music goes back to. */
export interface ReelSeam {
  readonly apartDb: number | null;
  readonly levelDb: number | null;
  readonly overSeconds: number;
}

export interface ReelMusic {
  readonly bars: ReelBars;
  /** The seam where the reel's music goes back `back` seconds at reel time `at`. */
  seam(at: number, back: number): ReelSeam;
}

/** The music of a template's kept reel, measured; null when the template keeps no reel with sound on this Mac. */
export type ReelMusicSource = (templateId: TemplateId, signal?: AbortSignal) => AsyncResult<ReelMusic | null>;

export interface ReelMusicDeps {
  /** Absent: no reel's music can be measured here, and the length tools say so. */
  readonly reelMusic?: ReelMusicSource;
}
