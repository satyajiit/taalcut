// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Language id via whisper-cli `-dl`. No probability cutoff: every slice is
 * returned and the route decides. The runner owns the process; this function
 * puts `binary` and `-m` on the args only when deps supply them.
 */
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { runProcess } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { LanguageDetectFailed } from '../errors';

export interface WhisperRun {
  (
    args: readonly string[],
    options?: { signal?: AbortSignal },
  ): AsyncResult<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface LanguageDetection {
  readonly language: string | null;
  readonly probability: number | null;
  readonly perSlice: { language: string; probability: number }[];
}

const DETECTED_LINE = /auto-detected language:\s*([^\s()]+)\s*\(\s*p\s*=\s*([+-]?\d+(?:\.\d+)?)\s*\)/;

function cancelled(signal: AbortSignal | undefined, error?: TaalcutError): boolean {
  if (signal?.aborted) return true;
  const code = error?.code;
  return code === 'core.cancelled' || code === 'media.cancelled' || code === 'helper.cancelled';
}

function detectArgs(binary: string, model: string, path: string): string[] {
  const args: string[] = [];
  if (binary) args.push(binary);
  if (model) args.push('-m', model);
  args.push('-dl', '-d', String(AUDIO_CONFIG.language.detectDurationMs), '-f', path);
  return args;
}

function parseLine(stderr: string): { language: string; probability: number } | null {
  const match = DETECTED_LINE.exec(stderr);
  const language = match?.[1];
  const raw = match?.[2];
  if (!language || raw === undefined) return null;
  const probability = Number(raw);
  if (!Number.isFinite(probability)) return null;
  return { language, probability };
}

/** One slice: that slice. Several: the code that appears most often; a tie keeps the earliest. */
function summarise(perSlice: readonly { language: string; probability: number }[]): {
  language: string | null;
  probability: number | null;
} {
  if (perSlice.length === 0) return { language: null, probability: null };
  const firstProbability = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const slice of perSlice) {
    if (!firstProbability.has(slice.language)) firstProbability.set(slice.language, slice.probability);
    counts.set(slice.language, (counts.get(slice.language) ?? 0) + 1);
  }
  let language = perSlice[0]?.language ?? null;
  let best = 0;
  for (const [code, count] of counts) {
    if (count > best) {
      language = code;
      best = count;
    }
  }
  return { language, probability: language === null ? null : (firstProbability.get(language) ?? null) };
}

export async function detectLanguage(
  slices: readonly (string | { path: string })[],
  deps: { binary: string; model: string; run?: WhisperRun; signal?: AbortSignal },
): AsyncResult<LanguageDetection> {
  if (slices.length === 0) return ok({ language: null, probability: null, perSlice: [] });
  const run = deps.run ?? createWhisperRunner(deps.binary);
  const perSlice: { language: string; probability: number }[] = [];
  for (const slice of slices) {
    if (cancelled(deps.signal)) return err(CancelledError());
    const path = typeof slice === 'string' ? slice : slice.path;
    const result = await run(detectArgs(deps.binary, deps.model, path), { signal: deps.signal });
    if (!result.ok) {
      if (cancelled(deps.signal, result.error)) return err(CancelledError());
      return err(
        LanguageDetectFailed(undefined, { detail: (result.error.detail ?? result.error.code).slice(0, 500) }),
      );
    }
    if (cancelled(deps.signal)) return err(CancelledError());
    const line = parseLine(result.value.stderr);
    if (result.value.exitCode !== 0 || !line) {
      const tail = result.value.stderr.trim().slice(-400);
      const detail =
        tail.length > 0 ? `exit ${result.value.exitCode}: ${tail}` : `exit ${result.value.exitCode}`;
      return err(LanguageDetectFailed(undefined, { detail }));
    }
    perSlice.push(line);
  }
  return ok({ ...summarise(perSlice), perSlice });
}

/**
 * Spawns `binary` with the args. A leading copy of `binary` is removed so
 * `detectLanguage` can put it on the args without running it twice.
 */
export function createWhisperRunner(binary: string): WhisperRun {
  return async (args, options) => {
    const argv = args[0] === binary ? args.slice(1) : [...args];
    const result = await runProcess(binary, argv, { signal: options?.signal });
    if (!result.ok) return result;
    return ok({
      stdout: result.value.stdout.toString('utf8'),
      stderr: result.value.stderrTail,
      exitCode: result.value.exitCode ?? 1,
    });
  };
}
