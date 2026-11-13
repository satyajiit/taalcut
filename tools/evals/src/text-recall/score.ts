// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scores one library's stored on-screen text against the manifest's known lines (IX3-B1), by the word rule in
 * words.ts. Pure: the library was read (library.ts) and the lines parsed before. Each line also says what was read
 * around it: the texts of the shots whose time overlaps the line's, widened by `slack` seconds, so a miss shows
 * whether OCR read the caption wrongly ("WARDIM") or not at all.
 */
import type { StoredShot, StoredText } from './library';
import { tokensOf, wordKey, type KnownLine } from './words';

/** Seconds a shot may sit outside a line's time and still count as around it (one OCR sample a second). */
export const READ_SLACK_SECONDS = 0.5;

export interface LineScore {
  readonly file: string;
  readonly line: string;
  readonly found: readonly string[];
  readonly missed: readonly string[];
  /** The distinct on-screen texts of the shots around the line, one per stored text line. */
  readonly read: readonly string[];
}

export interface LibraryScore {
  readonly path: string;
  readonly lines: readonly LineScore[];
  readonly found: number;
  readonly total: number;
  /** `<file>:<word>` for every word not read, sorted. */
  readonly missed: readonly string[];
}

const around = (shot: StoredShot, line: KnownLine, slack: number) =>
  shot.from < line.to + slack && shot.to > line.from - slack;

/** A shot's stored text holds one line per text it tracked. */
const textLines = (text: string) =>
  text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '');

function scoreLine(line: KnownLine, shots: readonly StoredShot[], slack: number): LineScore {
  const tokens = new Set(shots.flatMap((shot) => tokensOf(shot.text)));
  const read = [
    ...new Set(shots.filter((shot) => around(shot, line, slack)).flatMap((shot) => textLines(shot.text))),
  ];
  return {
    file: line.file,
    line: line.line,
    found: line.words.filter((word) => tokens.has(word)),
    missed: line.words.filter((word) => !tokens.has(word)),
    read,
  };
}

export function scoreLibrary(
  text: StoredText,
  lines: readonly KnownLine[],
  slack = READ_SLACK_SECONDS,
): LibraryScore {
  const scored = lines.map((line) => scoreLine(line, text.files.get(line.file) ?? [], slack));
  return {
    path: text.path,
    lines: scored,
    found: scored.reduce((sum, line) => sum + line.found.length, 0),
    total: lines.reduce((sum, line) => sum + line.words.length, 0),
    missed: scored.flatMap((line) => line.missed.map((word) => wordKey(line.file, word))).sort(),
  };
}

/** Every `<file>:<word>` the score read, sorted. */
export const foundKeys = (score: LibraryScore): string[] =>
  score.lines.flatMap((line) => line.found.map((word) => wordKey(line.file, word))).sort();
