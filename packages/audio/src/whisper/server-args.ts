// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `whisper-server` arguments (whisper.cpp v1.9.5's examples/server), pure. The server keeps one model loaded and
 * answers multipart POSTs. What keeps it private and equal to `whisper-cli`:
 * - loopback only, on a port picked per launch, every route under a random path (`--request-path`), so nothing
 *   that doesn't know the path (a web page, another process) can reach `/inference` or `/load`;
 * - `--public` points at a folder that doesn't exist, so it serves no files;
 * - beam 5, best of 5 (whisper-cli's default; the server's is greedy), and `-ml` large enough that it never
 *   wraps segments (the server turns 0 into 60 characters, which splits words);
 * - `small` with flash attention off and DTW (`-nfa --dtw small`), as the CLI path runs it; `-ng` for the CPU;
 * - `-pp` prints progress lines, which become the job's progress.
 */
import { usesSmallDtw, WHISPER_BEAM } from './decoder';

export interface WhisperServerConfig {
  readonly binary: string;
  readonly model: string;
  /** False: the CPU (`-ng`). */
  readonly gpu: boolean;
}

export interface WhisperServerAddress {
  readonly port: number;
  /** Path segment every route sits under: hex, no slash. */
  readonly secret: string;
  /** A folder that doesn't exist. */
  readonly noPublic: string;
}

/** Larger than any segment's characters: the server never wraps one. */
const NO_WRAP = 1_000_000;

export function whisperServerArgs(config: WhisperServerConfig, address: WhisperServerAddress): string[] {
  return [
    '-m',
    config.model,
    '--host',
    '127.0.0.1',
    '--port',
    String(address.port),
    '--request-path',
    `/${address.secret}`,
    '--public',
    address.noPublic,
    '-bs',
    String(WHISPER_BEAM.beamSize),
    '-bo',
    String(WHISPER_BEAM.bestOf),
    '-ml',
    String(NO_WRAP),
    '-pp',
    ...(usesSmallDtw(config.model) ? ['-nfa', '--dtw', 'small'] : []),
    ...(config.gpu ? [] : ['-ng']),
  ];
}

/** The pool's key: one process per binary, model and backend. */
export function serverKey(config: WhisperServerConfig): string {
  return JSON.stringify([config.binary, config.model, config.gpu]);
}

const PROGRESS = /progress\s*=\s*(\d+)%/;

/** A `-pp` progress line's fraction, or undefined. */
export function progressOf(line: string): number | undefined {
  const match = PROGRESS.exec(line);
  return match?.[1] === undefined ? undefined : Math.min(1, Number(match[1]) / 100);
}

/** What whisper.cpp says about its GPU while it loads: in use, or not (the CPU then runs it). */
export function gpuLine(line: string): 'gpu' | 'cpu' | undefined {
  if (/whisper_backend_init_gpu: (no GPU found|failed to initialize)/.test(line)) return 'cpu';
  if (/whisper_backend_init_gpu: using \S+ backend/.test(line)) return 'gpu';
  return undefined;
}
