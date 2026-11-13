// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A child process for the test stand-ins: argv only (no shell), stdout as bytes, stderr's tail. */
import { spawn } from 'node:child_process';
import { CancelledError, err, ok, UnknownError, type AsyncResult } from '@taalcut/core';

export interface ProcessResult {
  readonly stdout: Buffer;
  readonly stderr: string;
}

export function runProcess(
  binary: string,
  args: readonly string[],
  signal?: AbortSignal,
): AsyncResult<ProcessResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(err(CancelledError()));
    const child = spawn(binary, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-64_000);
    });
    child.on('error', (cause) =>
      resolve(err(signal?.aborted ? CancelledError() : UnknownError(undefined, { detail: String(cause) }))),
    );
    child.on('close', (code) => {
      if (signal?.aborted) return resolve(err(CancelledError()));
      if (code !== 0)
        return resolve(err(UnknownError(undefined, { detail: `exit ${code}: ${stderr.slice(-2000)}` })));
      resolve(ok({ stdout: Buffer.concat(out), stderr }));
    });
  });
}
