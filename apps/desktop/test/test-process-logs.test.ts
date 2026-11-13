// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachUtilityStderr, installLogCapture } from '../src/main/debug/log-ring';
import { stampedLines, TEST_LOG_DIR_ENV, writeProcessLogs } from '../src/main/test-process-logs';

const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const AT = new Date('2026-10-25T03:42:00.000Z');

function logDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-logs-'));
  dirs.push(dir);
  return join(dir, 'app-logs-1');
}

describe('the test build’s process logs (TAALCUT_TEST_LOG_DIR)', () => {
  it('stamps each line of a chunk, partial last line included, and skips empty ones', () => {
    expect(stampedLines('first\r\nsecond\n\nthird', AT)).toBe(
      `${AT.toISOString()} first\n${AT.toISOString()} second\n${AT.toISOString()} third\n`,
    );
    expect(stampedLines('\n', AT)).toBe('');
  });

  it('writes main’s console and each utility’s stderr to their own files as they arrive', () => {
    const dir = logDir();
    installLogCapture();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stop = writeProcessLogs({ env: { [TEST_LOG_DIR_ENV]: dir }, now: () => AT });
    if (!stop) throw new Error('no log for a set folder');
    stops.push(stop);
    const jobs = new PassThrough();
    attachUtilityStderr('jobs', jobs);
    jobs.write('[audio] whisper-server was not ready in time\n');
    console.warn('[utility] jobs exited with code 9');
    expect(readFileSync(join(dir, 'jobs.log'), 'utf8')).toBe(
      `${AT.toISOString()} [audio] whisper-server was not ready in time\n`,
    );
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('[utility] jobs exited with code 9');
  });

  it('is off without the variable, and stops once (saying so) when its folder can’t be written', () => {
    expect(writeProcessLogs({ env: {} })).toBeNull();
    const dir = logDir();
    const said = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const append = vi.fn(() => {
      throw new Error('ENOENT');
    });
    const stop = writeProcessLogs({ env: { [TEST_LOG_DIR_ENV]: dir }, append });
    if (stop) stops.push(stop);
    const agent = new PassThrough();
    attachUtilityStderr('agent', agent);
    agent.write('one\n');
    agent.write('two\n');
    expect(append).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith(expect.stringContaining(`stopped writing to ${dir}`));
  });
});
