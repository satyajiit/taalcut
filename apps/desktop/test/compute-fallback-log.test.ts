// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeFallbackEvent, cpuFallback, createEventBus } from '@taalcut/core';
import { COMPUTE_FALLBACK_LOG_ENV, logComputeFallbacks } from '../src/main/compute-fallback-log';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bus = () => createEventBus({ clock: { now: () => 1_800_000_000_000 } });

describe('the test build’s compute.fallback log (IX3-B4)', () => {
  it('appends each compute.fallback on main’s bus as one JSON line, until stopped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fallback-log-'));
    dirs.push(dir);
    const path = join(dir, 'run-1', 'compute-fallbacks.jsonl');
    const events = bus();
    const stop = logComputeFallbacks({ events, env: { [COMPUTE_FALLBACK_LOG_ENV]: path } });
    const choice = cpuFallback('no_accelerator');
    if (choice.backend !== 'cpu') throw new Error('cpuFallback chose a GPU');
    events.emit(
      'compute.fallback',
      computeFallbackEvent('vision.embedFrames', ['coreml', 'webgpu', 'cpu'], choice.fallback),
    );
    events.emit('compute.fallback', {
      operation: 'audio.transcribe',
      wanted: ['metal'],
      reason: 'accelerator_failed',
      detail: 'whisper',
    });
    stop?.();
    events.emit('compute.fallback', { operation: 'after.stop', wanted: [], reason: 'no_accelerator' });
    const lines = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([
      {
        at: 1_800_000_000_000,
        operation: 'vision.embedFrames',
        wanted: ['coreml', 'webgpu'],
        reason: 'no_accelerator',
      },
      {
        at: 1_800_000_000_000,
        operation: 'audio.transcribe',
        wanted: ['metal'],
        reason: 'accelerator_failed',
        detail: 'whisper',
      },
    ]);
  });

  it('creates the file at once, so a run without fallbacks still shows it recorded', () => {
    const written: [string, string][] = [];
    const append = (path: string, line: string) => void written.push([path, line]);
    logComputeFallbacks({ events: bus(), env: { [COMPUTE_FALLBACK_LOG_ENV]: '/run/f.jsonl' }, append });
    expect(written).toEqual([['/run/f.jsonl', '']]);
  });

  it('does nothing when the variable is unset or blank', () => {
    const written: string[] = [];
    const append = (_path: string, line: string) => void written.push(line);
    expect(logComputeFallbacks({ events: bus(), env: {}, append })).toBeNull();
    expect(
      logComputeFallbacks({ events: bus(), env: { [COMPUTE_FALLBACK_LOG_ENV]: '  ' }, append }),
    ).toBeNull();
    expect(written).toEqual([]);
  });
});
