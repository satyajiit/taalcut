// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** How the hardware probes run system tools: a fixed binary and arguments, no shell, output captured. */
import { execFile } from 'node:child_process';

export interface CommandOutput {
  readonly stdout: string;
  readonly exitCode: number;
}

/** Runs a fixed binary with arguments (no shell). Must not throw on a non-zero exit. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  options: { readonly signal?: AbortSignal },
) => Promise<CommandOutput>;

export const defaultCommandRunner: CommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}) },
      (error, stdout) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ stdout: String(stdout ?? ''), exitCode: code });
      },
    );
  });
