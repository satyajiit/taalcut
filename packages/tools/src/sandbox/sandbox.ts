// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * createExperimentSandbox: core's ExperimentSandbox port. In the jobs process
 * (exec mode) `run` validates the request and starts the child under the
 * wrapper and a Seatbelt profile; in the agent process (job mode) `run`
 * enqueues the `sandbox.run` job, so children always start in the jobs
 * process. Both modes open, list, read, discard and sweep the folders
 * directly with the same path checks.
 */
import { access, constants as fs, mkdir, realpath, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  AGENT_SANDBOX_PROGRAMS,
  DEFAULT_SANDBOX_LIMITS,
  err,
  ok,
  systemClock,
  type AsyncResult,
  type Clock,
  type ExperimentId,
  type ExperimentSandbox,
  type JobRunner,
  type ProgramStop,
  type SandboxLimits,
  type SandboxProgram,
  type SandboxRunRequest,
  type SandboxRunResult,
} from '@taalcut/core';
import { SandboxDiskLimit, SandboxProgramNotAllowed, SandboxUnavailable } from './errors';
import { createExperimentFolders, type ExperimentFolders } from './experiments';
import { sandboxRunJob } from './job';
import { COOKIES_FILE, folderBytes, MANIFEST_FILE, TMP_DIR, walkFiles, type FileStamp } from './paths';
import { childEnv, defaultProfilesDir, profileParams, profilePath } from './profiles';
import { runConfined } from './runner';
import { prepareRun, type SandboxPrograms } from './validate';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** Free space a run must leave on the disk, beyond the experiment's own cap. */
export const FREE_SPACE_RESERVE = 1024 ** 3;
/**
 * What each program's run may hold (IX3-K2): FFmpeg may decode or encode on VideoToolbox (`-hwaccel videotoolbox`,
 * a `*_videotoolbox` codec), so it is never SIGKILLed; ffprobe, yt-dlp and the helper (`ocr` only) hold none.
 */
export const HOLDS_VIDEO_SESSION: Readonly<Record<SandboxProgram, boolean>> = {
  ffmpeg: true,
  ffprobe: false,
  macHelper: false,
  ytDlp: false,
};
/** The sandbox's FFmpeg runs with `-nostdin` and no stdin, so it can't be asked; it traps SIGTERM. */
const SANDBOXED_FFMPEG_STOP: ProgramStop = { ask: 'none', orderlySigterm: true };

interface CommonOptions {
  /** `<userData>/scratch`: never inside a library source. */
  readonly root: string;
  readonly clock?: Clock;
}

/**
 * The app-wide cap on hardware video sessions, adapted by the caller (media's gate: tools may not import media).
 * Called before every run with the validated program and arguments; the lease is held until the child exits.
 * A run whose program opens no hardware session gets a lease that holds nothing. `adopt` records the child's pid
 * on disk before it returns, so its sessions stay held while it runs even after this process is gone (a quit or a
 * crash; media's lease, IX3-F5 H4, IX3-F7).
 */
export type SandboxHardwareSessions = (
  program: string,
  args: readonly string[],
  signal?: AbortSignal,
) => AsyncResult<{ release(): Promise<void>; adopt?(pid: number): void }>;

/** The jobs process: children start here. */
export interface ExecSandboxOptions extends CommonOptions {
  readonly programs: SandboxPrograms;
  /** Default `/usr/bin/sandbox-exec`. Missing: every run is `sandbox.unavailable`. */
  readonly sandboxExec?: string;
  /** The user's home folder, denied to children. Default `os.homedir()`. */
  readonly home?: string;
  /** Defaults for every run; a request's own limits override them. */
  readonly limits?: Partial<SandboxLimits>;
  /** Where offline.sb and fetcher.sb are (a bundled app copies them). Default: next to this module. */
  readonly profilesDir?: string;
  /** Free space each run leaves on the disk. Default 1 GiB. */
  readonly freeSpaceReserve?: number;
  /** Held around each run, so an agent's `-hwaccel videotoolbox` counts against the app's cap. */
  readonly hardwareSessions?: SandboxHardwareSessions;
}

/** The agent process: `run` goes through the `sandbox.run` job. */
export interface JobSandboxOptions extends CommonOptions {
  readonly jobs: JobRunner;
}

export type ExperimentSandboxOptions = ExecSandboxOptions | JobSandboxOptions;

type RunOptions = Parameters<ExperimentSandbox['run']>[2];

export function createExperimentSandbox(options: ExperimentSandboxOptions): ExperimentSandbox {
  const folders = createExperimentFolders({ root: options.root, clock: options.clock ?? systemClock });
  const run = 'jobs' in options ? jobRun(options.jobs) : execRun(options, folders);
  return {
    open: (input) => folders.open(input),
    get: (id) => folders.get(id),
    run,
    list: (id, dir) => folders.list(id, dir),
    readText: (id, path, maxBytes) => folders.readText(id, path, maxBytes),
    discard: (id) => folders.discard(id),
    sweep: () => folders.sweep(),
  };
}

function jobRun(jobs: JobRunner) {
  return async (id: ExperimentId, request: SandboxRunRequest, options: RunOptions = {}) => {
    const program = request.program;
    if (!(AGENT_SANDBOX_PROGRAMS as readonly string[]).includes(program))
      return err(SandboxProgramNotAllowed({ program }));
    const input = {
      experimentId: id,
      request: {
        program: program as (typeof AGENT_SANDBOX_PROGRAMS)[number],
        args: [...request.args],
        ...(request.inputs ? { inputs: [...request.inputs] } : {}),
        ...(request.limits ? { limits: request.limits } : {}),
        ...(request.network === 'none' ? { network: 'none' as const } : {}),
      },
    };
    if (request.network === 'outbound') return err(SandboxProgramNotAllowed({ program }));
    return jobs.run(sandboxRunJob, input, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
  };
}

/** Files created or changed during the run, relative to the experiment; the manifest and TMPDIR aside. */
function writtenSince(before: Map<string, FileStamp>, after: Map<string, FileStamp>) {
  const written: { path: string; bytes: number }[] = [];
  for (const [path, stamp] of after) {
    if (path === MANIFEST_FILE || path === COOKIES_FILE || path.startsWith(`${TMP_DIR}/`)) continue;
    const old = before.get(path);
    if (!old || old.bytes !== stamp.bytes || old.mtimeMs !== stamp.mtimeMs)
      written.push({ path, bytes: stamp.bytes });
  }
  return written.sort((a, b) => a.path.localeCompare(b.path));
}

/** Gives a lease back after its run exited; a failure is logged, never thrown into nothing. */
function releaseLease(lease: { release(): Promise<void> }): Promise<void> {
  return lease.release().catch((cause: unknown) => {
    console.warn(`[tools] sandbox: releasing a hardware session lease failed: ${String(cause)}`);
  });
}

async function freeBytes(dir: string): Promise<number> {
  const info = await statfs(dir).catch(() => null);
  return info ? Number(info.bavail) * Number(info.bsize) : Number.POSITIVE_INFINITY;
}

function execRun(options: ExecSandboxOptions, folders: ExperimentFolders) {
  const sandboxExec = options.sandboxExec ?? SANDBOX_EXEC;
  const profilesDir = options.profilesDir ?? defaultProfilesDir();
  const reserve = options.freeSpaceReserve ?? FREE_SPACE_RESERVE;
  let home: Promise<string> | undefined;
  const realHome = () =>
    (home ??= realpath(options.home ?? homedir()).catch(() => options.home ?? homedir()));

  return async (
    id: ExperimentId,
    request: SandboxRunRequest,
    runOptions: RunOptions = {},
  ): AsyncResult<SandboxRunResult> => {
    const experiment = await folders.touch(id);
    if (!experiment.ok) return experiment;
    const dir = experiment.value.dir;
    if (
      !(await access(sandboxExec, fs.X_OK).then(
        () => true,
        () => false,
      ))
    )
      return err(SandboxUnavailable(undefined, { detail: `${sandboxExec} is missing` }));
    const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits, ...request.limits };
    const prepared = await prepareRun(request, { dir, programs: options.programs, threads: limits.threads });
    if (!prepared.ok) return prepared;
    for (const folder of prepared.value.outputDirs) await mkdir(folder, { recursive: true });
    await mkdir(`${dir}/${TMP_DIR}`, { recursive: true });

    const used = await folderBytes(dir);
    const maxBytes = Math.min(limits.diskBytes, used + (await freeBytes(dir)) - reserve);
    if (maxBytes <= used)
      return err(SandboxDiskLimit({ bytes: limits.diskBytes }, { detail: 'not enough room on the disk' }));
    const before = await walkFiles(dir);
    runOptions.onProgress?.({ fraction: null });
    const sessions = options.hardwareSessions
      ? await options.hardwareSessions(prepared.value.programName, prepared.value.args, runOptions.signal)
      : undefined;
    if (sessions && !sessions.ok) return sessions;
    let result: Awaited<ReturnType<typeof runConfined>>;
    let outlived: Promise<void> | undefined;
    try {
      result = await runConfined(
        {
          sandboxExec,
          profile: profilePath(profilesDir, prepared.value.profile),
          params: profileParams(prepared.value, { dir, home: await realHome() }),
          program: prepared.value.program,
          args: prepared.value.args,
          cwd: dir,
          env: childEnv(prepared.value, dir),
          limits,
          watch: { dir, maxBytes },
          handlesCpuSignal: prepared.value.programName === 'ffmpeg',
          holdsVideoSession: HOLDS_VIDEO_SESSION[prepared.value.programName],
          ...(prepared.value.programName === 'ffmpeg' ? { stop: SANDBOXED_FFMPEG_STOP } : {}),
        },
        {
          ...(runOptions.signal ? { signal: runOptions.signal } : {}),
          ...(runOptions.onOutputLine ? { onOutputLine: runOptions.onOutputLine } : {}),
          onOutlive: (exited) => (outlived = exited),
          ...(sessions?.value.adopt ? { onSpawn: (pid: number) => sessions.value.adopt?.(pid) } : {}),
        },
      );
    } finally {
      // A run answered while it still runs keeps its lease until it exits: a stuck session stays counted.
      if (outlived && sessions) void outlived.then(() => releaseLease(sessions.value));
      else await sessions?.value.release();
    }
    if (!result.ok) return result;
    const written = writtenSince(before, await walkFiles(dir));
    await folders.touch(id);
    return ok({ ...result.value, written });
  };
}
