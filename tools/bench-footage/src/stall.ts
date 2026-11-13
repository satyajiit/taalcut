// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FFmpeg under a stall watch (IX, brief-common "VideoToolbox stalls"). A VideoToolbox encode can stall for good
 * (frame error -17691, then stuck at 0% CPU), and twice the Mac reset right after the stuck process was ended.
 * So nothing here ever signals or kills FFmpeg: a call that runs past `stallMs` stops being waited for, its pid,
 * command and a one-second `sample` go into `vt-stall-<time>.md` in `reportDir`, and the call fails naming that
 * file. The process is left running in its own process group (so a Ctrl-C of the bench does not reach it either),
 * with its stderr in a file rather than a pipe, so nothing breaks under it when this process goes away.
 */
import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

export interface StallWatch {
  /** How long one call may run before it counts as stalled. */
  readonly stallMs: number;
  /** Where stall reports (and each running call's stderr) go. */
  readonly reportDir: string;
  /** One second of the stalled process's stacks (`sample <pid> 1`); injectable for tests. */
  readonly sample?: (pid: number) => Promise<string>;
  readonly now?: () => Date;
}

export class StallError extends Error {
  constructor(
    readonly pid: number,
    readonly report: string,
  ) {
    super(`ffmpeg (pid ${pid}) stalled; left running, not killed (VideoToolbox stalls). Report: ${report}`);
    this.name = 'StallError';
  }
}

const run = promisify(execFile);

/** `sample <pid> 1`, its report text; or why there is none. */
export async function sampleOnce(pid: number): Promise<string> {
  try {
    const { stdout } = await run('/usr/bin/sample', [String(pid), '1'], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    return `sample failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export interface StallFacts {
  readonly pid: number;
  readonly command: readonly string[];
  readonly startedAt: Date;
  readonly waitedMs: number;
  readonly stderrPath: string;
  readonly sample: string;
}

export function stallReport(facts: StallFacts): string {
  return [
    `# FFmpeg stalled (pid ${facts.pid})`,
    '',
    `- Started ${facts.startedAt.toISOString()}; no exit after ${Math.round(facts.waitedMs / 1000)} s.`,
    '- Left running, not killed: ending a process stuck in VideoToolbox was followed by a watchdog reset twice.',
    '  Stop media work on this Mac and tell the orchestrator.',
    `- Its stderr so far: ${facts.stderrPath}`,
    '',
    '## Command',
    '',
    '```',
    facts.command.map((arg) => (/[\s'"]/.test(arg) ? `'${arg.replaceAll("'", "'\\''")}'` : arg)).join(' '),
    '```',
    '',
    '## sample <pid> 1',
    '',
    '```',
    facts.sample.trimEnd(),
    '```',
    '',
  ].join('\n');
}

const stamp = (date: Date) =>
  date
    .toISOString()
    .replaceAll(':', '')
    .replace(/\.\d+Z$/, 'Z');

let calls = 0;

/** Runs `binary args`; resolves when it exits 0, rejects with its stderr when it fails, or with a StallError. */
export function runWatched(binary: string, args: readonly string[], watch: StallWatch): Promise<void> {
  const now = watch.now ?? (() => new Date());
  mkdirSync(watch.reportDir, { recursive: true });
  calls += 1;
  const stderrPath = join(watch.reportDir, `ffmpeg-${process.pid}-${calls}.stderr`);
  const stderr = openSync(stderrPath, 'w');
  const startedAt = now();
  const child = spawn(binary, [...args], { stdio: ['ignore', 'ignore', stderr], detached: true });
  closeSync(stderr);
  const readStderr = () => (existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '');
  return new Promise((resolve, reject) => {
    let stalled = false;
    const timer = setTimeout(() => {
      stalled = true;
      const pid = child.pid ?? -1;
      // Stop waiting only: no signal, and this process may exit while the stalled one keeps running.
      child.unref();
      void (watch.sample ?? sampleOnce)(pid).then((sample) => {
        const report = join(watch.reportDir, `vt-stall-${stamp(now())}.md`);
        const command = [binary, ...args];
        writeFileSync(
          report,
          stallReport({ pid, command, startedAt, waitedMs: watch.stallMs, stderrPath, sample }),
        );
        reject(new StallError(pid, report));
      });
    }, watch.stallMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      rmSync(stderrPath, { force: true });
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (stalled) return;
      clearTimeout(timer);
      const text = readStderr();
      rmSync(stderrPath, { force: true });
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${signal ?? `exit ${code}`}): ${text.slice(-2000)}`));
    });
  });
}
