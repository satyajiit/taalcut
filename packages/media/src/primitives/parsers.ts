// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Parsers for the FFmpeg analysis filters this build actually prints
 * (scdet via metadata=print, blackdetect, freezedetect, ebur128, ssim).
 */

export interface SceneScore {
  readonly timeSec: number;
  readonly score: number;
  readonly mafd?: number;
}

export interface TimeInterval {
  readonly startSec: number;
  readonly endSec: number;
}

export interface LoudnessReading {
  readonly integratedLufs: number;
  readonly loudnessRange: number;
  readonly truePeakDbtp: number;
}

export interface SsimReading {
  readonly frames: readonly { readonly index: number; readonly all: number }[];
  readonly mean: number;
}

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;

function num(match: RegExpMatchArray | null, group = 1): number | undefined {
  if (!match) return undefined;
  const value = Number(match[group]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Score and MAFD for every sample, from `metadata=print` (a `frame:N … pts_time:T` line, then
 * `lavfi.scd.*=` lines). scdet's own log line (`lavfi.scd.score: …`) repeats the score and is not
 * a sample. Flat frames stay in the list.
 */
export function parseSceneScores(text: string): SceneScore[] {
  const scores: SceneScore[] = [];
  let current: { timeSec: number; score?: number; mafd?: number } | undefined;
  const flush = () => {
    if (current?.score === undefined) return;
    const { timeSec, score, mafd } = current;
    scores.push({ timeSec, score, ...(mafd === undefined ? {} : { mafd }) });
  };
  const frame = new RegExp(String.raw`\bframe:\s*\d+\b.*?pts_time:\s*(${NUM})`);
  const pair = new RegExp(String.raw`lavfi\.scd\.(score|mafd)=(${NUM})`);
  for (const line of text.split('\n')) {
    const at = num(frame.exec(line));
    if (at !== undefined) {
      flush();
      current = { timeSec: at };
      continue;
    }
    const value = pair.exec(line);
    const parsed = num(value, 2);
    if (current && value && parsed !== undefined) current[value[1] as 'score' | 'mafd'] = parsed;
  }
  flush();
  return scores;
}

export function parseBlackdetect(text: string): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  const pattern = new RegExp(String.raw`black_start:(${NUM})\s+black_end:(${NUM})`, 'g');
  for (const match of text.matchAll(pattern)) {
    const startSec = Number(match[1]);
    const endSec = Number(match[2]);
    if (Number.isFinite(startSec) && Number.isFinite(endSec)) intervals.push({ startSec, endSec });
  }
  return intervals;
}

/** A freeze that never prints freeze_end runs to `endSec` (the clip end). */
export function parseFreezedetect(text: string, endSec?: number): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  const startPattern = new RegExp(String.raw`freeze_start[=:\s]+(${NUM})`, 'g');
  const endPattern = new RegExp(String.raw`freeze_end[=:\s]+(${NUM})`, 'g');
  const starts = [...text.matchAll(startPattern)].map((match) => Number(match[1]));
  const ends = [...text.matchAll(endPattern)].map((match) => Number(match[1]));
  starts.forEach((value, index) => {
    const resolved = ends[index] ?? endSec;
    if (resolved !== undefined && Number.isFinite(value) && Number.isFinite(resolved)) {
      intervals.push({ startSec: value, endSec: resolved });
    }
  });
  return intervals;
}

/** ebur128 prints `inf` for a true peak of digital silence. Other parsers stay finite. */
const LOUD = String.raw`[-+]?(?:inf|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)`;

function loudNum(match: RegExpMatchArray | null, group = 1): number | undefined {
  const raw = match?.[group];
  if (raw === undefined) return undefined;
  if (raw === 'inf' || raw === '+inf') return Number.POSITIVE_INFINITY;
  if (raw === '-inf') return Number.NEGATIVE_INFINITY;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function lastLoud(text: string, pattern: string): RegExpMatchArray | null {
  const matches = [...text.matchAll(new RegExp(pattern, 'g'))];
  return matches[matches.length - 1] ?? null;
}

/** The summary is the last `I:` / `LRA:`. The running meter starts near -70 LUFS. */
export function parseEbur128(text: string): LoudnessReading | undefined {
  const integrated = loudNum(lastLoud(text, String.raw`I:\s*(${LOUD})\s*LUFS`));
  const range = loudNum(lastLoud(text, String.raw`LRA:\s*(${LOUD})`));
  const peaks = [...text.matchAll(new RegExp(String.raw`Peak:\s*(${LOUD})\s*dB`, 'g'))]
    .map((match) => loudNum(match))
    .filter((value): value is number => value !== undefined);
  if (integrated === undefined || range === undefined || peaks.length === 0) return undefined;
  return { integratedLufs: integrated, loudnessRange: range, truePeakDbtp: Math.max(...peaks) };
}

export function parseSsim(stats: string, summary = ''): SsimReading {
  const frames: { index: number; all: number }[] = [];
  const pattern = new RegExp(String.raw`n:(\d+).*?\bAll:(${NUM})`, 'g');
  for (const match of stats.matchAll(pattern)) {
    frames.push({ index: Number(match[1]), all: Number(match[2]) });
  }
  const fromSummary = num(new RegExp(String.raw`\bAll:(${NUM})`).exec(summary));
  const mean =
    fromSummary ??
    (frames.length === 0 ? 0 : frames.reduce((sum, frame) => sum + frame.all, 0) / frames.length);
  return { frames, mean };
}
