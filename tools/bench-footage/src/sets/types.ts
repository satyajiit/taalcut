// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a footage set asks for, as data. A set names its clips; each clip's shots, transitions, on-screen text
 * and music come from the set's seed (plan.ts), so the same set always plans the same footage. A clip may
 * instead give its shots and transitions as a script (IX3-D1: fades through black and their look-alikes, placed
 * exactly); the seed then only picks each look's parameters.
 */
import type { Look } from '../look-names';

export type Codec = 'h264' | 'hevc';

/**
 * Through black from the shot before: it fades out over its last `out` seconds, black holds for `hold`, and the
 * next shot fades in over its first `in`. A side of 0 is a hard cut to (from) the black; both 0 with a hold is a cut
 * to black and back, not a fade.
 */
export interface FadeEntry {
  readonly out: number;
  readonly hold: number;
  readonly in: number;
}

/** How a scripted shot begins (the first shot's entry is ignored). */
export type ScriptedEntry =
  | { readonly kind: 'cut' }
  | { readonly kind: 'dissolve'; readonly seconds: number }
  | ({ readonly kind: 'fade' } & FadeEntry);

export interface ScriptedShot {
  readonly look: Look;
  /** The shot's own length (a dissolve overlaps the shot before; a fade's black is between them). */
  readonly seconds: number;
  /** Absent: a hard cut. */
  readonly entry?: ScriptedEntry;
  /** Low-key (night footage): dark, its level drifting in and out of blackdetect's black, no fade. */
  readonly dark?: boolean;
}
export type SpeechLanguage = 'en' | 'es' | 'pt-BR' | 'hi';

/** What plays under the clip besides speech. */
export type Bed = 'none' | 'music' | 'noise' | 'room';

export interface SpeechSpec {
  readonly language: SpeechLanguage;
  /** macOS `say` voices to try, in order; the first one this Mac has speaks. */
  readonly voices: readonly string[];
  readonly text: string;
  /**
   * A word only this clip says, for the bench's search check; null when the clip is not a search probe (a probe
   * clip has no music bed, so its language is clear).
   */
  readonly probe: string | null;
}

export interface ClipSpec {
  readonly file: string;
  /** The picture as it is shown: a portrait clip is 1080 × 1920 here and stored landscape with a rotation tag. */
  readonly width: number;
  readonly height: number;
  readonly fps: 30 | 60;
  readonly codec: Codec;
  /** Mean video bitrate, as phones record (FFmpeg's `-b:v`). */
  readonly bitrate: string;
  readonly seconds: number;
  readonly speech: SpeechSpec | null;
  readonly bed: Bed;
  /** The camera's clock: written as creation_time (and the QuickTime creation date in a .mov). */
  readonly createdAt: string;
  /** Lines to show on screen over some shots (the OCR stage reads them). */
  readonly onScreen: readonly string[];
  /** Whether one shot is SMPTE colour bars, for the bench's "looks like" search. */
  readonly bars: boolean;
  /** The shots and transitions exactly as written, instead of the seed's (no on-screen text, no bars). */
  readonly script?: readonly ScriptedShot[];
}

export interface FootageSet {
  readonly name: string;
  /** Bump when anything here changes the footage, so an older generated set no longer matches. */
  readonly version: number;
  readonly seed: number;
  readonly clips: readonly ClipSpec[];
  /** A query only frame vectors can answer: no file name or speech holds its words. */
  readonly looksProbe: string;
}
