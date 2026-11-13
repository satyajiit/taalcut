// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-screen text recall eval's word rule (IX3-B1), the one round IX2's `library-recall.py` used, so the numbers
 * carry over: a text is upper-cased and split into tokens, each a maximal run of ASCII letters and digits, Latin-1
 * letters (À–ÿ) and Devanagari (U+0900–U+097F); everything else separates. A manifest line's words are its tokens
 * (each once). A word is read when it equals a token of the on-screen text stored on any shot of its file: whole
 * tokens, so "4" is not read inside "1400" and "PARK" is not read as "PHRK"; any shot, since a line shows once per
 * file and the rest of a file's text is clocks and textures.
 */
import { z } from 'zod';

// Devanagari first: after another letter, its first code point (a combining mark) would read as one character.
const TOKEN = /[\u0900-\u097F0-9A-Za-z\u00C0-\u00FF]+/gu;

/** The distinct tokens of `text`, upper-cased, in the order they first appear. */
export function tokensOf(text: string): string[] {
  return [...new Set(text.toUpperCase().match(TOKEN) ?? [])];
}

/** The footage manifest's on-screen lines (tools/bench-footage writes them for ix-v1): what each clip shows, and when. */
export const textManifestSchema = z.looseObject({
  set: z.string().optional(),
  clips: z.array(
    z.looseObject({
      file: z.string().min(1),
      onScreen: z
        .array(
          z.object({
            line: z.string().min(1),
            /** Seconds into the clip. */
            from: z.number().nonnegative(),
            to: z.number().nonnegative(),
          }),
        )
        .default([]),
    }),
  ),
});
export type TextManifest = z.output<typeof textManifestSchema>;

export interface KnownLine {
  readonly file: string;
  readonly line: string;
  readonly from: number;
  readonly to: number;
  /** The line's words by the rule above. */
  readonly words: readonly string[];
}

/** Every line the manifest says is on screen, in manifest order. */
export function knownLines(manifest: TextManifest): KnownLine[] {
  return manifest.clips.flatMap((clip) =>
    clip.onScreen.map((shown) => ({
      file: clip.file,
      line: shown.line,
      from: shown.from,
      to: shown.to,
      words: tokensOf(shown.line),
    })),
  );
}

/** A word as the report and the baseline name it: `<file>:<word>`. */
export const wordKey = (file: string, word: string): string => `${file}:${word}`;
