// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The filters an FFmpeg build has, from `ffmpeg -filters`. */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed } from './errors';
import { ffmpegPrelude, mediaEnv, type MediaContext } from './ffmpeg';
import { runProcess } from './process/runner';

/** ' .S tonemap           V->V       Conversion to/from different dynamic ranges.' */
const LINE = /^\s*[A-Z.|]{2,3}\s+(\S+)\s+\S+->\S+\s/;

export function parseFilters(text: string): Set<string> {
  // The legend above the '------' line looks like filter rows; skip it.
  const start = text.indexOf('------');
  const names = new Set<string>();
  if (start === -1) return names;
  for (const line of text.slice(start + 6).split('\n')) {
    const name = LINE.exec(line)?.[1];
    if (name) names.add(name);
  }
  return names;
}

export async function detectFilters(
  ctx: MediaContext,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): AsyncResult<Set<string>> {
  const args = ['-filters'];
  const result = await (ctx.runner ?? runProcess)(ctx.binaries.ffmpeg, [...ffmpegPrelude(args), ...args], {
    env: mediaEnv(ctx),
    timeoutMs: options.timeoutMs ?? 15_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    const exitCode = result.value.exitCode ?? -1;
    return err(FfmpegFailed({ exitCode }, { detail: `ffmpeg -filters failed\n${result.value.stderrTail}` }));
  }
  return ok(parseFilters(result.value.stdout.toString('utf8')));
}
