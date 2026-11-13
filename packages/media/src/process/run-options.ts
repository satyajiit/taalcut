// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The process runner's contract (runner.ts): its options, its output, and the runner as an injectable function. */
import type { AsyncResult } from '@taalcut/core';
import type { ProgramStop } from './end-policy';

export interface RunOptions {
  /** Aborting stops the process (the end policy says how). The result is `media.cancelled`. */
  readonly signal?: AbortSignal;
  /** Stop the process after this many milliseconds. The result is `media.timeout`. */
  readonly timeoutMs?: number;
  /** The grace period between the end policy's steps, and how long to wait for the pipes after exit. Default 2000 ms. */
  readonly killGraceMs?: number;
  /** Capture limit for stdout; going over stops the process with `media.output_too_large`. Default 16 MiB. */
  readonly maxStdoutBytes?: number;
  /** How much of the end of stderr to keep for error detail. Default 8 KiB. */
  readonly stderrTailBytes?: number;
  /** Stream stdout here instead of capturing it (used for `-progress pipe:1` and raw frames). */
  readonly onStdout?: (chunk: Buffer) => void;
  /** Stream every stderr chunk. The tail is still kept for error detail. */
  readonly onStderr?: (chunk: Buffer) => void;
  /** The child's whole environment. Default: `sidecarEnv()` (PATH, TMPDIR and locale only). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /**
   * The process may hold a hardware video session (a VideoToolbox decode or encode), declared by the run's site
   * (IX3-K2). It is then never SIGKILLed: see end-policy.ts. Default false: this runner runs any program and
   * can't know; `runFfmpeg` and `runFfmpegRaw` declare FFmpeg runs.
   */
  readonly holdsVideoSession?: boolean;
  /** How the program stops when asked (end-policy.ts). Default `PLAIN_STOP`; FFmpeg's is `FFMPEG_STOP`. */
  readonly program?: ProgramStop;
  /**
   * Called just before the runner settles while the process is still running: a run that may hold a video
   * session, past its grace (it is never killed). `exited` resolves when it exits; what the caller holds for the
   * run (a hardware session lease) stays held until then.
   */
  readonly onOutlive?: (exited: Promise<void>) => void;
  /** Called once the process has started, with its pid (a hardware session lease records it, IX3-F5 H4). */
  readonly onSpawn?: (pid: number) => void;
}

export interface ProcessOutput {
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** Captured stdout (empty when `onStdout` streams it). */
  readonly stdout: Buffer;
  /** The last `stderrTailBytes` of stderr, as text. */
  readonly stderrTail: string;
  readonly durationMs: number;
}

/** The runner as an injectable function, so tests and other hosts can swap it. */
export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => AsyncResult<ProcessOutput>;
