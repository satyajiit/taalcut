// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawn } from 'node:child_process';
import { computeFallbackEvent, selectBackend } from '@taalcut/core';

/**
 * Gray-code strips and burned-in words have to survive the file. VideoToolbox
 * H.264 is not a candidate; ffv1 on the CPU is the lossless path.
 */
export function assertLosslessEncode(operation: string, detail: string): void {
  const result = selectBackend(['videotoolbox', 'cpu'], (backend) => backend === 'cpu', {
    fallbackReason: 'unsupported_input',
    detail,
  });
  if (!result.ok) throw new Error(result.error.detail ?? result.error.messageKey);
  if (result.value.backend === 'cpu') {
    const event = computeFallbackEvent(operation, ['videotoolbox', 'cpu'], result.value.fallback);
    console.warn(`${event.operation}: ${event.reason}`);
  }
}

export function runFfmpeg(ffmpeg: string, args: string[], stdin?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const clock: { timer?: ReturnType<typeof setTimeout> } = {};
    const finish = (error: Error | undefined, value?: Buffer): void => {
      if (settled) return;
      settled = true;
      if (clock.timer !== undefined) clearTimeout(clock.timer);
      if (error) reject(error);
      else resolve(value ?? Buffer.alloc(0));
    };
    clock.timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('ffmpeg timed out'));
    }, 60_000);
    child.stdout?.on('data', (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = Buffer.concat(stderr).toString('utf8').trim().slice(-800);
        finish(new Error(`ffmpeg exited ${code ?? 'null'}${tail.length > 0 ? `: ${tail}` : ''}`));
        return;
      }
      finish(undefined, Buffer.concat(stdout));
    });
    if (stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        // ffmpeg may close the pipe early. The close handler reports the exit.
      });
      child.stdin.end(stdin);
    }
  });
}
