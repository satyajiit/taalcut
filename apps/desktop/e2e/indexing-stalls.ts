// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Before the indexing e2e closes the app: is any FFmpeg process under it stuck (alive a while, no
 * CPU time gained over a few seconds)? A process stuck in VideoToolbox must not be ended: twice the Mac reset
 * right after one was (brief-common "VideoToolbox stalls"). If one is, the test writes a stall report (pid,
 * command, `sample <pid> 1`) into TAALCUT_VT_STALL_DIR and leaves the app running; the bench then stops.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sampleOnce, stallReport } from '@taalcut/bench-footage';
import { devCache } from './dev-cache';

const run = promisify(execFile);

/** Where the indexing e2e reports stalls: TAALCUT_VT_STALL_DIR (the bench sets it), else a dev cache folder. */
export const e2eStallDir = (): string => process.env.TAALCUT_VT_STALL_DIR?.trim() || devCache('vt-stalls');

/**
 * The app's FFmpeg processes (they talk to VideoToolbox). The mac helper is left out: it idles at no CPU between
 * requests until its idle exit, which would look stuck.
 */
const MEDIA = /(^|\/)(ffmpeg|ffprobe)$/;
/** Younger than this, a quiet process is just starting. */
const MIN_AGE_S = 60;

interface PsLine {
  readonly pid: number;
  readonly ppid: number;
  readonly ageS: number;
  readonly cpuS: number;
  readonly command: string;
}

/** `[[dd-]hh:]mm:ss[.cc]` as seconds. */
export function psSeconds(text: string): number {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = (rest ?? '').split(':').map(Number);
  return parts.reduce((sum, part) => sum * 60 + part, 0) + Number(days) * 86_400;
}

export function parsePsLines(text: string): PsLine[] {
  return text.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) return [];
    const [, pid = '', ppid = '', age = '', cpu = '', command = ''] = match;
    return [{ pid: Number(pid), ppid: Number(ppid), ageS: psSeconds(age), cpuS: psSeconds(cpu), command }];
  });
}

async function snapshot(): Promise<PsLine[]> {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,etime=,time=,command='], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return parsePsLines(stdout);
}

/** Every process under `root` (not `root` itself). */
export function descendants(lines: readonly PsLine[], root: number): PsLine[] {
  const under = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const line of lines)
      if (!under.has(line.pid) && under.has(line.ppid)) {
        under.add(line.pid);
        grew = true;
      }
  }
  return lines.filter((line) => line.pid !== root && under.has(line.pid));
}

/** Media processes under `root` that are old enough and gained no CPU time between the two snapshots. */
export function stuckOf(before: readonly PsLine[], after: readonly PsLine[], root: number): PsLine[] {
  return descendants(after, root).filter((line) => {
    const binary = line.command.split(' ')[0] ?? '';
    const earlier = before.find((other) => other.pid === line.pid);
    return (
      MEDIA.test(binary) && line.ageS >= MIN_AGE_S && earlier !== undefined && earlier.cpuS === line.cpuS
    );
  });
}

/** Looks for stuck media processes under the app; reports each one. Returns the report paths (empty: none). */
export async function reportStuckMedia(appPid: number, windowMs = 3_000): Promise<string[]> {
  const before = await snapshot();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const stuck = stuckOf(before, await snapshot(), appPid);
  const dir = e2eStallDir();
  mkdirSync(dir, { recursive: true });
  const reports: string[] = [];
  for (const line of stuck) {
    const report = join(
      dir,
      `vt-stall-${new Date()
        .toISOString()
        .replaceAll(':', '')
        .replace(/\.\d+Z$/, 'Z')}-${line.pid}.md`,
    );
    const text = stallReport({
      pid: line.pid,
      command: line.command.split(' '),
      startedAt: new Date(Date.now() - line.ageS * 1000),
      waitedMs: line.ageS * 1000,
      stderrPath: '(the app keeps it)',
      sample: await sampleOnce(line.pid),
    });
    writeFileSync(report, text);
    reports.push(report);
  }
  return reports;
}
