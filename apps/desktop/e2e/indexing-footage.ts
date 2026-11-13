// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The footage the indexing e2e imports, with what the test expects of it:
 * the files, the seconds of video, which files speak which language and a
 * word only that file says, and a query only frame vectors can answer.
 *
 * - Default: the generated library (indexing-library.ts), one minute of
 *   video; with TAALCUT_INDEX_BENCH=1 three minutes of the same mix, the
 *   bench's `smoke` set.
 * - TAALCUT_BENCH_FOOTAGE set: a set tools/bench-footage generated there
 *   (the bench's `ix-v1`), read from its manifest.json: its files and
 *   seconds, the clips that are search probes and its looks query.
 */
import { readManifest, type Manifest } from '@taalcut/bench-footage';
import { generatedLibrary, libraryUnavailable, SPOKEN } from './indexing-library';

export interface SpokenProbe {
  readonly file: string;
  /** The language the transcript must come back in (its primary subtag: `pt` for pt-BR). */
  readonly language: string;
  /** A word only this file says. */
  readonly probe: string;
}

export interface IndexFootage {
  /** 'e2e' (the one-minute library), 'smoke' or a generated set's name. */
  readonly set: string;
  readonly dir: string;
  readonly files: readonly string[];
  readonly videoSeconds: number;
  readonly spoken: readonly SpokenProbe[];
  /** No file name or transcript holds these words: only the frame vectors can answer them. */
  readonly looks: string;
}

/** The transcript stores the language Whisper names, without a region. */
export const primaryLanguage = (tag: string): string => tag.split('-')[0] ?? tag;

/** A generated set as the test sees it. */
export function manifestFootage(dir: string, manifest: Manifest): IndexFootage {
  return {
    set: manifest.set,
    dir,
    files: manifest.clips.map((clip) => clip.file),
    videoSeconds: manifest.totalSeconds,
    spoken: manifest.clips.flatMap(({ file, speech }) =>
      speech?.probe ? [{ file, language: primaryLanguage(speech.language), probe: speech.probe }] : [],
    ),
    looks: manifest.looksProbe,
  };
}

const benchFootage = (): string | undefined => process.env.TAALCUT_BENCH_FOOTAGE?.trim() || undefined;
const libraryScale = (bench: boolean): number => (bench ? 0.3 : 0.1);

/** Why `indexFootage` has nothing for this machine, or undefined (a bench set is any machine's). */
export const footageUnavailable = (bench: boolean): string | undefined =>
  benchFootage() ? undefined : libraryUnavailable(libraryScale(bench));

export async function indexFootage(ffmpeg: string, bench: boolean): Promise<IndexFootage> {
  const generated = benchFootage();
  if (generated) return manifestFootage(generated, readManifest(generated));
  const library = await generatedLibrary(ffmpeg, libraryScale(bench));
  return {
    set: bench ? 'smoke' : 'e2e',
    dir: library.dir,
    files: library.files,
    videoSeconds: library.videoSeconds,
    spoken: [
      { file: 'harbour-4k-hevc.mov', language: 'en', probe: SPOKEN.lighthouse },
      { file: 'market-4k-h264.mp4', language: 'hi', probe: SPOKEN.monsoon },
    ],
    looks: 'colour bars test pattern',
  };
}
