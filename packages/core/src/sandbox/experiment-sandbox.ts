// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The experiment sandbox (P2-T2): a scratch folder per breakdown or
 * analysis, where bundled programs run with limits, offline, and whose
 * files are swept when they expire. Implemented by @taalcut/tools
 * (`createExperimentSandbox`), used by @taalcut/templates and the `sandbox`
 * tools. Programs and their arguments are checked per program by the
 * implementation; paths are `scratch:<relative>` or `input:<n>`.
 */
import type { ExperimentId, ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { JobProgress } from '../jobs/job-types';

export const SANDBOX_PROGRAMS = ['ffmpeg', 'ffprobe', 'macHelper', 'ytDlp'] as const;
export type SandboxProgram = (typeof SANDBOX_PROGRAMS)[number];
/** What the agent's `sandbox.run` may start. `ytDlp` belongs to the reference fetcher alone. */
export const AGENT_SANDBOX_PROGRAMS = [
  'ffmpeg',
  'ffprobe',
  'macHelper',
] as const satisfies readonly SandboxProgram[];
export const EXPERIMENT_PURPOSES = ['breakdown', 'analysis'] as const;
export type ExperimentPurpose = (typeof EXPERIMENT_PURPOSES)[number];

export interface Experiment {
  readonly id: ExperimentId;
  readonly projectId: ProjectId | null;
  readonly purpose: ExperimentPurpose;
  /** Absolute; under the scratch root, never inside a library source. */
  readonly dir: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface SandboxLimits {
  readonly cpuSeconds: number;
  readonly wallMs: number;
  /** The whole experiment folder. */
  readonly diskBytes: number;
  readonly maxFileBytes: number;
  readonly threads: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  cpuSeconds: 120,
  wallMs: 120_000,
  diskBytes: 2 * 1024 ** 3,
  maxFileBytes: 1024 ** 3,
  threads: 4,
};

export interface SandboxRunRequest {
  readonly program: SandboxProgram;
  /** Validated per program. Paths are `scratch:<relative>` or `input:<n>`. */
  readonly args: readonly string[];
  /** Absolute paths outside the experiment the run may read (library media the caller resolved); at most 16. */
  readonly inputs?: readonly string[];
  readonly limits?: Partial<SandboxLimits>;
  /** 'outbound' only for ytDlp; everything else runs offline. */
  readonly network?: 'none' | 'outbound';
}

export interface SandboxRunResult {
  readonly exitCode: number;
  /** At most 64 KiB, UTF-8. */
  readonly stdout: string;
  readonly stderrTail: string;
  readonly durationMs: number;
  /** Files created or changed, relative to the experiment. */
  readonly written: readonly { readonly path: string; readonly bytes: number }[];
}

export interface SandboxFile {
  readonly path: string;
  readonly bytes: number;
  readonly kind: 'file' | 'directory';
}

export interface ExperimentSandbox {
  open(input: {
    readonly id: ExperimentId;
    readonly projectId: ProjectId | null;
    readonly purpose: ExperimentPurpose;
    readonly ttlMs?: number;
  }): AsyncResult<Experiment>;
  get(id: ExperimentId): AsyncResult<Experiment>;
  run(
    id: ExperimentId,
    request: SandboxRunRequest,
    options?: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (progress: JobProgress) => void;
      readonly onOutputLine?: (stream: 'stdout' | 'stderr', line: string) => void;
    },
  ): AsyncResult<SandboxRunResult>;
  list(id: ExperimentId, dir?: string): AsyncResult<SandboxFile[]>;
  readText(id: ExperimentId, path: string, maxBytes?: number): AsyncResult<string>;
  discard(id: ExperimentId): AsyncResult<{ readonly freedBytes: number }>;
  /** Expired experiments and folders without a valid manifest. */
  sweep(): AsyncResult<{ readonly removed: readonly ExperimentId[] }>;
}

export const ExperimentSandboxToken = createToken<ExperimentSandbox>('core.experimentSandbox');
