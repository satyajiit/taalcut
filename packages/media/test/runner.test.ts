// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The process runner, exercised with small Node child processes so it needs no
 * FFmpeg: argument arrays, capture caps, exit codes, timeouts, and the
 * SIGTERM-then-SIGKILL cancellation sequence.
 */
import { describe, expect, it } from 'vitest';
import { runProcess, type ProcessOutput } from '@taalcut/media';

const node = process.execPath;
const script = (code: string, ...args: string[]) => ['-e', code, ...args];

/** Runs a child that prints 'ready' once its signal handlers are set, then aborts it. */
/**
 * Runs `code` and aborts once it says it's ready. `elapsed` runs from the abort (SIGTERM) to the result, so it is
 * about the runner's escalation, not how long node took to start on a busy machine (UX2 round 2: 6.2 s from spawn
 * under load, 49 ms alone).
 */
async function abortWhenReady(code: string, killGraceMs: number) {
  const controller = new AbortController();
  let aborted = 0;
  const result = await runProcess(node, script(code), {
    signal: controller.signal,
    killGraceMs,
    onStdout: (chunk) => {
      if (aborted === 0 && chunk.toString().includes('ready')) {
        aborted = Date.now();
        controller.abort();
      }
    },
  });
  if (aborted === 0) throw new Error('the child never said it was ready');
  return { result, elapsed: Date.now() - aborted };
}

describe('runProcess', () => {
  it('captures stdout, the stderr tail and the exit code', async () => {
    const result = await runProcess(
      node,
      script("process.stdout.write('hello'); process.stderr.write('first\\nlast line\\n'); process.exit(3)"),
    );
    expect(result.ok).toBe(true);
    const out = (result as { value: ProcessOutput }).value;
    expect(out.exitCode).toBe(3);
    expect(out.signal).toBeNull();
    expect(out.stdout.toString()).toBe('hello');
    expect(out.stderrTail).toBe('first\nlast line');
  });

  it('passes arguments literally, with no shell in between', async () => {
    const tricky = ['a b', '$(echo pwned)', '; rm -rf /', '`id`', "'quoted'", '*'];
    const result = await runProcess(
      node,
      script('process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...tricky),
    );
    expect(result.ok && JSON.parse(result.value.stdout.toString())).toEqual(tricky);
  });

  it('keeps only the tail of a long stderr', async () => {
    const result = await runProcess(
      node,
      script("process.stderr.write('x'.repeat(100000) + '\\nTHE END\\n')"),
      { stderrTailBytes: 1024 },
    );
    expect(result.ok).toBe(true);
    const tail = result.ok ? result.value.stderrTail : '';
    expect(tail.length).toBeLessThanOrEqual(1024);
    expect(tail.endsWith('THE END')).toBe(true);
  });

  it('stops a process that writes more stdout than the cap', async () => {
    const result = await runProcess(
      node,
      script('process.stdout.write(Buffer.alloc(1e6)); setInterval(() => {}, 1000)'),
      {
        maxStdoutBytes: 1000,
      },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.output_too_large',
      params: { limitBytes: 1000 },
    });
  });

  it('times out, terminating the process', async () => {
    const started = Date.now();
    const result = await runProcess(
      node,
      script("process.stderr.write('working\\n'); setInterval(() => {}, 1000)"),
      {
        timeoutMs: 300,
      },
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.timeout',
      retryable: true,
      params: { ms: 300 },
    });
    expect(!result.ok && result.error.detail).toMatch(
      /stopped \(timeout\) with SIGTERM, ended by signal SIGTERM/,
    );
  });

  it('cancels with SIGTERM, which a cooperative process obeys', async () => {
    const code =
      "process.on('SIGTERM', () => { process.stderr.write('got SIGTERM\\n'); process.exit(255); });" +
      "setInterval(() => {}, 1000); process.stdout.write('ready');";
    const { result, elapsed } = await abortWhenReady(code, 5000);
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    const detail = (!result.ok && result.error.detail) || '';
    expect(detail).toContain('ended by exit code 255');
    expect(detail).toContain('got SIGTERM');
    expect(detail).not.toContain('SIGKILL');
    expect(elapsed).toBeLessThan(5000);
  });

  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    const code =
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready');";
    const { result, elapsed } = await abortWhenReady(code, 300);
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    expect(!result.ok && result.error.detail).toContain(
      'ended by signal SIGKILL; ignored SIGTERM, sent SIGKILL after 300 ms',
    );
    expect(elapsed).toBeGreaterThanOrEqual(300);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runProcess('/definitely/not/here', [], { signal: controller.signal });
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.cancelled',
      detail: 'aborted before start',
    });
  });

  it('reports a missing binary as media.ffmpeg_not_found', async () => {
    const result = await runProcess('/definitely/not/here/ffmpeg', ['-version']);
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.ffmpeg_not_found',
      params: { binary: 'ffmpeg' },
    });
  });

  it('rejects arguments the OS cannot take as a validation error', async () => {
    const result = await runProcess(node, ['-e', '1', 'nul\0byte']);
    expect(!result.ok && result.error.code).toBe('core.validation');
  });
});
