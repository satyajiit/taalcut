// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * whisper.cpp as a process per call: `whisper-cli` loads the model, reads one WAV and exits. `-ojf` writes the
 * tokens to a JSON file next to a temporary name; `small` gets `-nfa --dtw small`. Metal is tried first and the
 * call runs once more with `-ng` when Metal fails to start (a logged CPU fallback). Language ID is `-dl` on the
 * file (`detectLanguage`). Kept for the reference flow and as the fallback when the server binary is missing.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CancelledError,
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type TaalcutError,
} from '@taalcut/core';
import { EngineUnavailable, LanguageDetectFailed, TranscriptionFailed } from '../errors';
import { createWhisperRunner, detectLanguage, type WhisperRun } from '../speech/detect';
import { parseWhisperJson } from '../speech/whisper-parse';
import {
  usesSmallDtw,
  type WhisperDecoded,
  type WhisperDecoder,
  type WhisperLanguageFlag,
  type WhisperLanguageGuess,
  type WhisperLanguageRequest,
  type WhisperTranscribeRequest,
} from './decoder';

export interface CliDecoderDeps {
  readonly binary: string;
  /** whisper-cli `-mc` when set. Jobs omit it. */
  readonly ctx?: number;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly run?: WhisperRun;
}

function cliArgs(
  model: string,
  audio: string,
  tmpBase: string,
  language: WhisperLanguageFlag,
  ctx: number | undefined,
): string[] {
  const args = ['-m', model, '-f', audio, '-ojf', '-of', tmpBase, '-l', language];
  if (usesSmallDtw(model)) args.push('-nfa', '--dtw', 'small');
  if (ctx !== undefined && ctx > 0) args.push('-mc', String(Math.floor(ctx)));
  return args;
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 500 ? trimmed.slice(-500) : trimmed;
}

function metalInitFailed(stderr: string, exitCode: number): boolean {
  if (stderr.includes('falling back to CPU')) return true;
  if (exitCode === 0) return false;
  return /metal/i.test(stderr) || /gpu device/i.test(stderr);
}

function fromRun(error: TaalcutError, signal?: AbortSignal) {
  if (signal?.aborted || error.code === 'core.cancelled' || error.code === 'media.cancelled')
    return err(CancelledError());
  if (error.code === 'media.ffmpeg_not_found')
    return err(EngineUnavailable({ engine: 'whisper' }, { detail: error.detail ?? error.code }));
  return err(TranscriptionFailed(undefined, { detail: (error.detail ?? error.code).slice(0, 500) }));
}

async function readTokens(jsonPath: string): AsyncResult<WhisperDecoded> {
  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf8');
  } catch {
    return err(TranscriptionFailed(undefined, { detail: 'whisper json missing' }));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return err(TranscriptionFailed(undefined, { detail: 'whisper json invalid' }));
  }
  const parsed = parseWhisperJson(json);
  return ok({ tokens: parsed.tokens, language: parsed.language });
}

interface RunOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The run on Metal, and once more with `-ng` when Metal failed to start (a logged CPU fallback). */
async function runMetalFirst(
  deps: CliDecoderDeps,
  run: WhisperRun,
  args: readonly string[],
  signal?: AbortSignal,
): AsyncResult<RunOutput> {
  const first = await run(args, { signal });
  if (!first.ok) return fromRun(first.error, signal);
  if (!metalInitFailed(first.value.stderr, first.value.exitCode)) return first;
  const choice = cpuFallback('accelerator_failed', clip(first.value.stderr) || 'metal init failed');
  if (choice.backend === 'cpu')
    deps.onFallback?.(computeFallbackEvent('audio.transcribe', ['metal', 'cpu'], choice.fallback));
  if (signal?.aborted) return err(CancelledError());
  const second = await run([...args, '-ng'], { signal });
  return second.ok ? second : fromRun(second.error, signal);
}

async function transcribeCli(
  deps: CliDecoderDeps,
  run: WhisperRun,
  request: WhisperTranscribeRequest,
): AsyncResult<WhisperDecoded> {
  const { signal } = request;
  if (signal?.aborted) return err(CancelledError());
  const tmpBase = join(tmpdir(), `taalcut-whisper-${randomUUID()}`);
  const jsonPath = `${tmpBase}.json`;
  try {
    const args = cliArgs(request.model, request.audio, tmpBase, request.language, deps.ctx);
    const output = await runMetalFirst(deps, run, args, signal);
    if (!output.ok) return output;
    const { stderr, exitCode } = output.value;
    if (exitCode !== 0)
      return err(TranscriptionFailed(undefined, { detail: clip(stderr) || `exit ${exitCode}` }));
    const decoded = await readTokens(jsonPath);
    if (decoded.ok) request.onProgress?.(1);
    return decoded;
  } finally {
    await rm(jsonPath, { force: true });
  }
}

async function identifyCli(
  deps: CliDecoderDeps,
  run: WhisperRun,
  request: WhisperLanguageRequest,
): AsyncResult<WhisperLanguageGuess> {
  const detected = await detectLanguage([request.audio], {
    binary: deps.binary,
    model: request.model,
    run,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (!detected.ok) return detected;
  const first = detected.value.perSlice[0];
  if (!first) return err(LanguageDetectFailed(undefined, { detail: 'whisper detected no language' }));
  return ok(first);
}

export function createCliWhisperDecoder(deps: CliDecoderDeps): WhisperDecoder {
  const run = deps.run ?? createWhisperRunner(deps.binary);
  return {
    mode: 'process-per-call',
    transcribe: (request) => transcribeCli(deps, run, request),
    identifyLanguage: (request) => identifyCli(deps, run, request),
  };
}
