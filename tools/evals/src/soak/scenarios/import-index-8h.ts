// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { SAMPLE_INTERVAL_MS, mergeEvents, playEvents, sampleTimes } from '../sampler';
import { type SoakApp, type SoakClock, type SoakScenario, type SoakSink } from '../scenario';
import { HOUR_MS, scoreTimeGrowth, WARMUP_MS, type SoakRssSample } from '../score';
import { type SoakMode } from '../result';

export const IMPORT_INDEX_HOURS = 8;
export const BATCH_INTERVAL_MS = 10 * 60 * 1000;
export const UPLOAD_INTERVAL_MS = 30 * 60 * 1000;
export const IMPORT_DURATION_MS = IMPORT_INDEX_HOURS * 60 * 60 * 1000;
export const FULL_BATCHES = IMPORT_DURATION_MS / BATCH_INTERVAL_MS;
export const FULL_UPLOADS = IMPORT_DURATION_MS / UPLOAD_INTERVAL_MS;
export const SMOKE_BATCHES = 2;
export const SMOKE_UPLOADS = 1;
export const IMPORT_BATCH_SIZE = 4;

/**
 * Smoke keeps the 8 h shape (15 min warm-up, 1 h windows, 8 h span) and shortens the unit.
 * 4_800 ms stands in for 480 minutes, so the fake clock still crosses both hours.
 */
export const SMOKE_DURATION_MS = 4_800;
export const SMOKE_WARMUP_MS = 150;
export const SMOKE_HOUR_MS = 600;
export const SMOKE_SAMPLE_INTERVAL_MS = 100;
export const SMOKE_BATCH_INTERVAL_MS = 100;
export const SMOKE_UPLOAD_INTERVAL_MS = 300;

export interface ImportSchedule {
  batches: number;
  uploads: number;
  batchIntervalMs: number;
  uploadIntervalMs: number;
  durationMs: number;
  sampleIntervalMs: number;
  warmupMs: number;
  hourMs: number;
}

export function importSchedule(mode: SoakMode): ImportSchedule {
  if (mode === 'smoke') {
    return {
      batches: SMOKE_BATCHES,
      uploads: SMOKE_UPLOADS,
      batchIntervalMs: SMOKE_BATCH_INTERVAL_MS,
      uploadIntervalMs: SMOKE_UPLOAD_INTERVAL_MS,
      durationMs: SMOKE_DURATION_MS,
      sampleIntervalMs: SMOKE_SAMPLE_INTERVAL_MS,
      warmupMs: SMOKE_WARMUP_MS,
      hourMs: SMOKE_HOUR_MS,
    };
  }
  return {
    batches: FULL_BATCHES,
    uploads: FULL_UPLOADS,
    batchIntervalMs: BATCH_INTERVAL_MS,
    uploadIntervalMs: UPLOAD_INTERVAL_MS,
    durationMs: IMPORT_DURATION_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    warmupMs: WARMUP_MS,
    hourMs: HOUR_MS,
  };
}

/** First 0-based sample() call that falls in the smoke late hour. */
export function smokeLateSampleIndex(): number {
  const schedule = importSchedule('smoke');
  const times = sampleTimes(schedule.durationMs, schedule.sampleIntervalMs);
  const lateStart = schedule.durationMs - schedule.hourMs;
  const index = times.findIndex((at) => at >= lateStart);
  if (index < 0) throw new Error('smoke timeline has no late-hour sample');
  return index;
}

async function runImport(app: SoakApp, clock: SoakClock, sink: SoakSink, mode: SoakMode): Promise<void> {
  const schedule = importSchedule(mode);
  const work: { at: number; kind: string }[] = [];
  for (let index = 0; index < schedule.batches; index += 1) {
    work.push({ at: index * schedule.batchIntervalMs, kind: 'batch' });
  }
  for (let index = 0; index < schedule.uploads; index += 1) {
    work.push({ at: index * schedule.uploadIntervalMs, kind: 'upload' });
  }
  const events = mergeEvents(work, sampleTimes(schedule.durationMs, schedule.sampleIntervalMs));
  let batches = 0;
  let uploads = 0;
  await playEvents(clock, events, async (event) => {
    if (event.kind === 'batch') {
      batches += 1;
      const batch = await app.importBatch(IMPORT_BATCH_SIZE);
      for (const asset of batch.hashes) sink.imported(asset);
      // Indexing must stay busy. Idle after a batch is a named failure.
      if (await app.indexIdle()) sink.fail(`index-idle:batch:${batches}`);
      return;
    }
    if (event.kind === 'upload') {
      uploads += 1;
      sink.imported(await app.wifiUpload());
      if (await app.indexIdle()) sink.fail(`index-idle:upload:${uploads}`);
      return;
    }
    const reading = await app.sample();
    sink.recordSample({ at: event.at, ...reading });
  });
}

export const importIndexScenario: SoakScenario = {
  id: 'import-index-8h',
  hours: IMPORT_INDEX_HOURS,
  checks: ['index-not-idle', 'memory-growth', 'integrity'],
  run: runImport,
  score(samples: readonly SoakRssSample[], mode: SoakMode) {
    const schedule = importSchedule(mode);
    return scoreTimeGrowth(samples, {
      durationMs: schedule.durationMs,
      warmupMs: schedule.warmupMs,
      hourMs: schedule.hourMs,
    });
  },
};
