// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FFmpeg `silencedetect` log lines to silences, in milliseconds. Pure: the measure and the audio pass share it. */

export interface Silence {
  readonly startMs: number;
  readonly endMs: number;
}

/** FFmpeg's ways of saying the input has no sound stream to read. */
export function reportsNoAudio(detail: string): boolean {
  return /does not contain any stream|matches no streams|no audio stream|audio stream not found|Stream specifier ':a:0'/i.test(
    detail,
  );
}

/** Lines the parser reads; the audio pass keeps only these from a long log. */
export const SILENCE_LINE = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/;

/** Silences in log order. A silence that never ends runs to `durationMs`. */
export function parseSilenceLog(log: string, durationMs: number): Silence[] {
  const silences: Silence[] = [];
  let open: number | undefined;
  for (const match of log.matchAll(new RegExp(SILENCE_LINE.source, 'g'))) {
    const at = Number(match[2]);
    if (match[1] === 'start') {
      open = at;
      continue;
    }
    if (open === undefined) continue;
    silences.push({ startMs: Math.round(open * 1000), endMs: Math.round(at * 1000) });
    open = undefined;
  }
  if (open !== undefined) silences.push({ startMs: Math.round(open * 1000), endMs: durationMs });
  return silences;
}
