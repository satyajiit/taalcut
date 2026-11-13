// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One bench run as numbers (IX-B1): the machine and tier, the footage, the two finish lines per hour of
 * footage, each stage's busy and wall time, peak memory, the security agents' CPU, the load, whether it read
 * on-screen text (ocr.ts), and whether the run was noisy. The timeline (perf/timeline) supplies the finish lines
 * from the stage rows.
 */
import { MAC_HELPER_NAME } from './mac-helper';
import { noiseOf, type Noise } from './noise';
import type { OcrCounters, RunOcr, TextShots } from './ocr';
import type { RunDecodes } from './decodes';
import type { RunFallbacks } from './fallbacks';
import type { RunTextRecall } from './text-recall';
import type { TranscriptJobs } from './transcripts';
import { summariseProcesses, type ProcessSummary, type TreeMemory } from './processes';
import type { BenchTier, MachineFacts, ProcessSample, RunRecord } from './run-record';
import { minutesPerHour, round } from './stats';

export interface StageNumbers {
  readonly stage: string;
  readonly runs: number;
  readonly busyMs: number;
  readonly wallMs: number;
}

export interface RunSummary {
  readonly run: number;
  readonly measuredAt: string;
  readonly machine: MachineFacts;
  readonly tier: {
    readonly used: BenchTier;
    readonly assessed: BenchTier;
    readonly forced: BenchTier | null;
  };
  readonly footage: { readonly set: string; readonly files: number; readonly videoSeconds: number };
  /** Add folder until the test saw no stage row active (polled every 2 s): Phase 3's number. */
  readonly elapsedMs: number;
  readonly elapsedMinPerHour: number;
  /** Add folder until every asset was searchable, from the stage rows (timeline). */
  readonly searchableMs: number | null;
  readonly searchableMinPerHour: number | null;
  /** Add folder until the last stage row finished (timeline). */
  readonly completeMs: number | null;
  readonly completeMinPerHour: number | null;
  /** Descriptions held for their model and left out of complete (LIB1-FIX); null in runs from before. */
  readonly completeHeldForModel?: number | null;
  readonly stages: readonly StageNumbers[];
  readonly memory: { readonly jobs: TreeMemory | null; readonly agent: TreeMemory | null };
  readonly security: ProcessSummary['security'];
  /** mediaanalysisd, photoanalysisd and Spotlight while indexing ran (null in runs from before they were sampled). */
  readonly background: ProcessSummary['background'];
  readonly load: {
    readonly start: number | null;
    readonly end: number | null;
    readonly mean: number | null;
    readonly max: number | null;
  };
  readonly vectors: Readonly<Record<string, number>>;
  readonly ocr: RunOcr;
  /** Null without a timeline. */
  readonly transcripts: TranscriptJobs | null;
  /** Null before stage outputs carry decode counters. */
  readonly decodes: RunDecodes | null;
  /** The app's compute.fallback events (IX3-B4); null for a run that did not record them. */
  readonly fallbacks: RunFallbacks | null;
  /** On-screen text recall of the run's library (IX3-B1); null without on-screen lines in the footage. */
  readonly textRecall: RunTextRecall | null;
  readonly noise: Noise;
}

/** The two finish lines from Add folder, read from the run's stage rows (perf/timeline). */
export interface FinishLines {
  readonly searchableMs: number | null;
  readonly completeMs: number | null;
  /** Descriptions held for their model, which `completeMs` leaves out (perf/timeline milestones.ts). */
  readonly completeHeldForModel?: number;
  /** The ocr lane's counters over the run's stage outputs, when they report them. */
  readonly ocr?: OcrCounters | null;
  /** The jobs behind the run's audio.transcript rows (which engine transcribed). */
  readonly transcripts?: TranscriptJobs | null;
  /** The decode lane's counters, medians over the run's video files. */
  readonly decodes?: RunDecodes | null;
}

export interface RunInputs {
  readonly run: number;
  readonly record: RunRecord;
  readonly processes: readonly ProcessSample[];
  readonly finish: FinishLines | null;
  /** From the run's library copy; null without one. */
  readonly textShots: TextShots | null;
  /** The bench was set up with the mac helper, so a run without it is noisy. */
  readonly helperExpected: boolean;
  /** The run's compute.fallback events; null when it recorded none (absent: the same). */
  readonly fallbacks?: RunFallbacks | null;
  /** The run's on-screen text recall; null or absent when not scored. */
  readonly textRecall?: RunTextRecall | null;
}

export function summariseRun(inputs: RunInputs): RunSummary {
  const { record, finish } = inputs;
  const processes = summariseProcesses(inputs.processes, { from: record.addedAt, to: record.settledAt });
  const perHour = (ms: number | null) =>
    ms === null ? null : round(minutesPerHour(ms, record.videoSeconds));
  const load = {
    start: record.loadAverageAtStart[0] ?? null,
    end: record.loadAverageAtEnd[0] ?? null,
    mean: processes.load ? round(processes.load.mean, 2) : null,
    max: processes.load?.max ?? null,
  };
  const ocr: RunOcr = {
    helperSamples: processes.samples > 0 ? (processes.commandSamples[MAC_HELPER_NAME] ?? 0) : null,
    shots: inputs.textShots?.shots ?? null,
    textShots: inputs.textShots?.textShots ?? null,
    counters: finish?.ocr ?? null,
  };
  return {
    run: inputs.run,
    measuredAt: record.measuredAt,
    machine: record.machine,
    tier: {
      used: record.machine.tierForced ?? record.machine.tierAssessed,
      assessed: record.machine.tierAssessed,
      forced: record.machine.tierForced,
    },
    footage: { set: record.footage.set, files: record.files, videoSeconds: record.videoSeconds },
    elapsedMs: record.elapsedMs,
    elapsedMinPerHour: round(minutesPerHour(record.elapsedMs, record.videoSeconds)),
    searchableMs: finish?.searchableMs ?? null,
    searchableMinPerHour: perHour(finish?.searchableMs ?? null),
    completeMs: finish?.completeMs ?? null,
    completeMinPerHour: perHour(finish?.completeMs ?? null),
    completeHeldForModel: finish?.completeHeldForModel ?? null,
    stages: record.stages.map(({ stage, runs, busyMs, wallMs }) => ({ stage, runs, busyMs, wallMs })),
    memory: { jobs: processes.jobs, agent: processes.agent },
    security: processes.security,
    background: processes.background,
    load,
    vectors: record.vectors,
    ocr,
    transcripts: finish?.transcripts ?? null,
    decodes: finish?.decodes ?? null,
    fallbacks: inputs.fallbacks ?? null,
    textRecall: inputs.textRecall ?? null,
    noise: noiseOf({
      security: processes.security,
      background: processes.background,
      loadAtStart: load.start,
      loadMean: load.mean,
      cores: record.machine.cpuCores,
      performanceCores: record.machine.performanceCores,
      windowMs: record.settledAt - record.addedAt,
      processSamples: processes.samples,
      foreignCommands: record.foreignCommands.map(({ name, source }) => `${name} (${source})`),
      helperMissing: inputs.helperExpected && ocr.helperSamples === 0,
    }),
  };
}
