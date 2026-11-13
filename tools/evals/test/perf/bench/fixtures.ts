// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A bench run's files as the e2e writes them (perf-index.ts, perf-processes.ts), for the bench's tests. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcessSample, PsRow, RunRecord } from '../../../src/perf/bench/run-record';

export const ADDED_AT = 1_800_000_000_000;

export function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    v: 2,
    measuredAt: '2026-10-17T10:00:00.000Z',
    loadAverageAtStart: [4.2, 4, 3.9],
    loadAverageAtEnd: [6.1, 5, 4.1],
    machine: {
      chip: 'Apple M5 Max',
      machineModel: 'Mac17,1',
      memoryBytes: 64 * 1024 ** 3,
      cpuCores: 18,
      performanceCores: 6,
      efficiencyCores: 12,
      gpuCores: 40,
      neuralEngine: true,
      os: 'darwin 26.7.1',
      tierAssessed: 'high',
      tierForced: 'recommended',
    },
    footage: { set: 'smoke', dir: '/bench/footage/smoke', files: ['a.mov', 'b.mov'], videoSeconds: 180 },
    videoSeconds: 180,
    files: 2,
    addedAt: ADDED_AT,
    settledAt: ADDED_AT + 120_000,
    elapsedMs: 120_000,
    stagesWallMs: 118_000,
    stages: [
      { stage: 'library.hash', runs: 2, wallMs: 300, busyMs: 500 },
      { stage: 'vision.embed', runs: 2, wallMs: 60_000, busyMs: 50_000 },
    ],
    vectors: { frame: 40, transcript: 10 },
    minutesPerHourOfFootage: 40,
    pipeline: { stages: [], kinds: {} },
    foreignCommands: [],
    ...overrides,
  };
}

export const ps = (
  pid: number,
  ppid: number,
  rssKb: number,
  cpu: string,
  command: string,
  vendor?: string,
): PsRow => ({
  pid,
  ppid,
  rssKb,
  cpu,
  command,
  ...(vendor ? { vendor } : {}),
});

/**
 * Samples one second apart from Add folder: main (1) → jobs (10) → ffmpeg (11) and agent (20) → llama (21),
 * Sophos (90) using `sophosPerSecond` seconds of CPU per second and Forti (91) a tenth of a second; with
 * `helper`, the mac helper (12) under jobs as well; with `mediaPerSecond`, mediaanalysisd (95) using that much CPU.
 */
export function processSamples(
  count: number,
  sophosPerSecond = 1.5,
  helper = false,
  mediaPerSecond = 0,
): ProcessSample[] {
  return Array.from({ length: count }, (_, index) => {
    const sophos = 100 + index * sophosPerSecond;
    const forti = 10 + index * 0.1;
    const media = 300 + index * mediaPerSecond;
    const mediaRow: PsRow = {
      ...ps(
        95,
        1,
        1_300_000,
        `${Math.floor(media / 60)}:${(media % 60).toFixed(2)}`,
        '/System/mediaanalysisd',
      ),
      daemon: 'mediaanalysisd',
    };
    return {
      at: ADDED_AT + index * 1000,
      load: 4 + index,
      mainPid: 1,
      utilities: { jobs: 10, agent: 20 },
      rows: [
        ps(1, 0, 200_000, '0:10.00', '/Applications/Electron.app/Contents/MacOS/Electron'),
        ps(10, 1, 500_000 + index * 1000, '0:20.00', '/Electron Helper'),
        ps(11, 10, 300_000, '0:01.00', '/repo/tools/ffmpeg/dist/ffmpeg'),
        ...(helper ? [ps(12, 10, 60_000, '0:00.50', '/repo/native/mac-helper/dist/taalcut-mac-helper')] : []),
        ps(20, 1, 150_000, '0:02.00', '/Electron Helper'),
        ps(21, 20, 2_000_000, '0:03.00', '/components/llama-server'),
        ps(
          90,
          1,
          400_000,
          `${Math.floor(sophos / 60)}:${(sophos % 60).toFixed(2)}`,
          'SophosEventMonitor',
          'sophos',
        ),
        ps(
          91,
          1,
          20_000,
          `0:${forti.toFixed(2)}`,
          '/Library/Application Support/Fortinet/fctservctl2',
          'fortinet',
        ),
        ...(mediaPerSecond > 0 ? [mediaRow] : []),
      ],
    };
  });
}

/** Writes a run directory as the e2e leaves it. */
export function writeRun(dir: string, record: RunRecord, samples: readonly ProcessSample[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index-bench.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(
    join(dir, 'index-processes.jsonl'),
    samples.map((sample) => JSON.stringify(sample)).join('\n'),
  );
}
