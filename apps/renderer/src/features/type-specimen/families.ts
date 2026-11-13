// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* eslint-disable lingui/no-unlocalized-strings -- the families' own names */

/*
 * The families the app ships (src/fonts/fonts.css) and the bytes each adds to it: the woff2 files of the subsets
 * it ships, for the variable weight axis. A family's files load only when its characters are on screen.
 * test/fonts.test.ts keeps these sizes equal to the files.
 */

export type FamilyJob = 'interface' | 'numbers' | 'fallback' | 'script';

export interface Family {
  readonly name: string;
  readonly job: FamilyJob;
  /** ISO 15924 codes of the scripts it draws for the app (Intl names them in the reader's language). */
  readonly scripts: readonly string[];
  readonly weights: readonly [number, number];
  readonly bytes: number;
}

export const FAMILIES: readonly Family[] = [
  { name: 'Onest', job: 'interface', scripts: ['Latn', 'Cyrl'], weights: [100, 900], bytes: 144_660 },
  { name: 'JetBrains Mono', job: 'numbers', scripts: ['Latn'], weights: [100, 800], bytes: 86_244 },
  { name: 'Noto Sans', job: 'fallback', scripts: ['Grek', 'Latn', 'Cyrl'], weights: [100, 900], bytes: 341_532 },
  { name: 'Noto Sans Devanagari', job: 'script', scripts: ['Deva'], weights: [100, 900], bytes: 121_192 },
  { name: 'Noto Sans Bengali', job: 'script', scripts: ['Beng'], weights: [100, 900], bytes: 107_720 },
  { name: 'Noto Sans Gujarati', job: 'script', scripts: ['Gujr'], weights: [100, 900], bytes: 112_268 },
  { name: 'Noto Sans Gurmukhi', job: 'script', scripts: ['Guru'], weights: [100, 900], bytes: 33_824 },
  { name: 'Noto Sans Kannada', job: 'script', scripts: ['Knda'], weights: [100, 900], bytes: 90_796 },
  { name: 'Noto Sans Malayalam', job: 'script', scripts: ['Mlym'], weights: [100, 900], bytes: 89_468 },
  { name: 'Noto Sans Oriya', job: 'script', scripts: ['Orya'], weights: [100, 900], bytes: 98_872 },
  { name: 'Noto Sans Tamil', job: 'script', scripts: ['Taml'], weights: [100, 900], bytes: 50_468 },
  { name: 'Noto Sans Telugu', job: 'script', scripts: ['Telu'], weights: [100, 900], bytes: 123_972 },
  { name: 'Noto Sans Arabic', job: 'script', scripts: ['Arab'], weights: [100, 900], bytes: 165_960 },
  { name: 'Noto Sans Hebrew', job: 'script', scripts: ['Hebr'], weights: [100, 900], bytes: 12_264 },
  { name: 'Noto Sans Thai', job: 'script', scripts: ['Thai'], weights: [100, 900], bytes: 26_924 },
];

/** The CSS family name a family's faces are declared under. */
export const cssFamily = (family: Family): string => `${family.name} Variable`;
