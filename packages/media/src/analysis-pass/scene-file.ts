// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scene scores as `metadata=mode=print:file=…` writes them after `scdet`: a
 * `frame:N pts:… pts_time:…` line per frame (N counts the frames that reached
 * the filter, from 0), then its `lavfi.scd.*=` lines. The count is exact,
 * where a time would need rounding back onto the grid.
 */

export interface SceneFrame {
  /** Frames before this one on the branch (a branch that keeps every n-th frame counts samples). */
  readonly frame: number;
  readonly score: number;
  readonly mafd: number;
}

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const FRAME_LINE = /^frame:\s*(\d+)\b/;
const PAIR = new RegExp(String.raw`^lavfi\.scd\.(score|mafd)=(${NUM})`);

export function parseSceneFile(text: string): SceneFrame[] {
  const out: SceneFrame[] = [];
  let current: { frame: number; score?: number; mafd?: number } | undefined;
  const flush = () => {
    if (current?.score !== undefined)
      out.push({ frame: current.frame, score: current.score, mafd: current.mafd ?? 0 });
  };
  for (const line of text.split('\n')) {
    const frame = FRAME_LINE.exec(line);
    if (frame) {
      flush();
      current = { frame: Number(frame[1]) };
      continue;
    }
    const pair = PAIR.exec(line);
    const value = pair ? Number(pair[2]) : NaN;
    if (current && pair && Number.isFinite(value)) current[pair[1] as 'score' | 'mafd'] = value;
  }
  flush();
  return out;
}

/**
 * Keeps the lines of a stderr stream that match `pattern`, chunk by chunk, so
 * a long pass (scdet logs a line per frame) never holds its whole log.
 */
export function lineFilter(pattern: RegExp): { push(chunk: Buffer): void; text(): string } {
  const kept: string[] = [];
  let partial = '';
  return {
    push(chunk) {
      const lines = (partial + chunk.toString('utf8')).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) if (pattern.test(line)) kept.push(line);
    },
    text: () => [...kept, ...(pattern.test(partial) ? [partial] : [])].join('\n'),
  };
}
