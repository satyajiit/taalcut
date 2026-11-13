// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Everything that happens before a child starts: is the program allowed, may
 * it use the network, do its arguments pass their program's checks, and which
 * real paths go into the profile. Validation is the first line; the Seatbelt
 * profile is the second, so a validator bug isn't an escape.
 */
import { realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  err,
  ok,
  SANDBOX_PROGRAMS,
  type AsyncResult,
  type SandboxProgram,
  type SandboxRunRequest,
} from '@taalcut/core';
import {
  SandboxArgumentRejected,
  SandboxPathOutside,
  SandboxProgramNotAllowed,
  SandboxUnavailable,
} from './errors';
import { INPUT_PREFIX, isFile, resolveInside, SCRATCH_PREFIX } from './paths';
import { prepareFfmpegArgs, prepareFfprobeArgs, type ArgumentPaths } from './validate-ffmpeg';
import {
  networkProblem,
  prepareMacHelperArgs,
  prepareYtDlpArgs,
  type FetcherBinaries,
} from './validate-programs';

export const MAX_INPUTS = 16;
const MAX_ARGS = 512;
const MAX_ARG_LENGTH = 8192;

/** The bundled programs, as absolute paths. The fetcher's are resolved when a fetch runs. */
export interface SandboxPrograms {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly macHelper?: string;
  readonly ytDlp?: () => AsyncResult<FetcherBinaries>;
}

export interface PreparedRun {
  readonly profile: 'offline' | 'fetcher';
  readonly programName: SandboxProgram;
  /** Real path of the binary. */
  readonly program: string;
  readonly args: readonly string[];
  /** Real paths of the granted inputs, in order. */
  readonly inputs: readonly string[];
  /** Folders inside the experiment to create before the run (outputs' parents). */
  readonly outputDirs: readonly string[];
  readonly fetcher?: FetcherBinaries;
}

/** `scratch:` and `input:` resolution for one experiment and its granted inputs. */
export function argumentPaths(dir: string, inputs: readonly string[], outputDirs: string[]): ArgumentPaths {
  const scratch = async (arg: string, index: number) => {
    const full = await resolveInside(dir, arg.slice(SCRATCH_PREFIX.length));
    return full === null ? err(SandboxPathOutside({ index }, { detail: arg })) : ok(full);
  };
  return {
    isPath: (arg) => arg.startsWith(SCRATCH_PREFIX) || arg.startsWith(INPUT_PREFIX),
    async readFile(arg, index) {
      if (arg.startsWith(INPUT_PREFIX)) {
        const n = /^input:(\d{1,2})$/.exec(arg)?.[1];
        const path = n === undefined ? undefined : inputs[Number(n)];
        return path === undefined
          ? err(SandboxArgumentRejected({ index, reason: 'no such input' }))
          : ok(path);
      }
      const full = await scratch(arg, index);
      if (!full.ok) return full;
      return (await isFile(full.value))
        ? ok(full.value)
        : err(SandboxArgumentRejected({ index, reason: 'no such file' }));
    },
    async writeFile(arg, index) {
      if (!arg.startsWith(SCRATCH_PREFIX))
        return err(SandboxArgumentRejected({ index, reason: 'outputs go to scratch:' }));
      const full = await scratch(arg, index);
      if (full.ok && dirname(full.value) !== dir) outputDirs.push(dirname(full.value));
      return full;
    },
  };
}

async function realInputs(inputs: readonly string[]): AsyncResult<string[]> {
  if (inputs.length > MAX_INPUTS)
    return err(SandboxArgumentRejected({ index: -1, reason: 'at most 16 inputs' }));
  const real: string[] = [];
  for (const input of inputs) {
    const path = await realpath(input).catch(() => null);
    const info = path ? await stat(path).catch(() => null) : null;
    if (!path || !info?.isFile())
      return err(
        SandboxArgumentRejected({ index: -1, reason: 'granted input is not a file' }, { detail: input }),
      );
    real.push(path);
  }
  return ok(real);
}

async function binary(path: string | undefined, program: string): AsyncResult<string> {
  if (path === undefined)
    return err(SandboxUnavailable(undefined, { detail: `${program} is not configured` }));
  const real = await realpath(path).catch(() => null);
  return real ? ok(real) : err(SandboxUnavailable(undefined, { detail: `${program} not found` }));
}

/** Validates a request for an experiment folder (`dir`, real) and resolves what the child gets. */
export async function prepareRun(
  request: SandboxRunRequest,
  context: { readonly dir: string; readonly programs: SandboxPrograms; readonly threads: number },
): AsyncResult<PreparedRun> {
  const { programs, dir } = context;
  if (!(SANDBOX_PROGRAMS as readonly string[]).includes(request.program))
    return err(SandboxProgramNotAllowed({ program: String(request.program).slice(0, 40) }));
  if (request.args.length > MAX_ARGS)
    return err(SandboxArgumentRejected({ index: MAX_ARGS, reason: 'too many arguments' }));
  const long = request.args.findIndex((arg) => typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH);
  if (long >= 0) return err(SandboxArgumentRejected({ index: long, reason: 'argument too long' }));
  const network = networkProblem(request.program, request.network ?? 'none');
  if (!network.ok) return network;
  const inputs = await realInputs(request.inputs ?? []);
  if (!inputs.ok) return inputs;
  const outputDirs: string[] = [];
  const paths = argumentPaths(dir, inputs.value, outputDirs);
  const base = { programName: request.program, inputs: inputs.value, outputDirs };

  switch (request.program) {
    case 'ffmpeg':
    case 'ffprobe': {
      const program = await binary(programs[request.program], request.program);
      if (!program.ok) return program;
      const prepared =
        request.program === 'ffmpeg'
          ? await prepareFfmpegArgs(request.args, { paths, threads: context.threads })
          : await prepareFfprobeArgs(request.args, { paths });
      if (!prepared.ok) return prepared;
      return ok({ ...base, profile: 'offline', program: program.value, args: prepared.value.args });
    }
    case 'macHelper': {
      const program = await binary(programs.macHelper, 'macHelper');
      if (!program.ok) return program;
      const prepared = await prepareMacHelperArgs(request.args, { paths });
      if (!prepared.ok) return prepared;
      return ok({ ...base, profile: 'offline', program: program.value, args: prepared.value.args });
    }
    case 'ytDlp': {
      if (!programs.ytDlp) return err(SandboxUnavailable(undefined, { detail: 'no reference fetcher' }));
      const resolved = await programs.ytDlp();
      if (!resolved.ok) return resolved;
      const fetcher = await realFetcher(resolved.value);
      if (!fetcher.ok) return fetcher;
      const prepared = await prepareYtDlpArgs(request.args, { dir, paths, binaries: fetcher.value });
      if (!prepared.ok) return prepared;
      const program = fetcher.value.binary;
      return ok({ ...base, profile: 'fetcher', program, args: prepared.value.args, fetcher: fetcher.value });
    }
  }
}

async function realFetcher(binaries: FetcherBinaries): AsyncResult<FetcherBinaries> {
  const ytDlp = await binary(binaries.binary, 'yt-dlp');
  const deno = await binary(binaries.deno, 'deno');
  const folder = await binary(binaries.ffmpegDir, 'ffmpeg folder');
  if (!ytDlp.ok) return ytDlp;
  if (!deno.ok) return deno;
  if (!folder.ok) return folder;
  const ffmpegDir = await realFfmpegDir(folder.value);
  if (!ffmpegDir.ok) return ffmpegDir;
  const dirs: string[] = [];
  for (const path of binaries.componentDirs.slice(0, 4)) {
    const real = await binary(path, 'component folder');
    if (!real.ok) return real;
    dirs.push(real.value);
  }
  return ok({ binary: ytDlp.value, deno: deno.value, ffmpegDir: ffmpegDir.value, componentDirs: dirs });
}

/**
 * Seatbelt allows the literal path yt-dlp passes to posix_spawn. A worktree
 * may symlink ffmpeg into another checkout; follow that link so the allowed
 * path is the binary that actually runs. A folder with no binaries stays as
 * the folder.
 */
async function realFfmpegDir(folder: string): AsyncResult<string> {
  const ffmpeg = await realpath(join(folder, 'ffmpeg')).catch(() => null);
  const ffprobe = await realpath(join(folder, 'ffprobe')).catch(() => null);
  if (!ffmpeg && !ffprobe) return ok(folder);
  if (!ffmpeg || !ffprobe || dirname(ffmpeg) !== dirname(ffprobe))
    return err(SandboxUnavailable(undefined, { detail: 'ffmpeg and ffprobe are not beside each other' }));
  return ok(dirname(ffmpeg));
}

/** The FFmpeg pair yt-dlp may start, beside each other in the bundled folder. */
export function fetcherFfmpeg(binaries: FetcherBinaries): { ffmpeg: string; ffprobe: string } {
  return { ffmpeg: join(binaries.ffmpegDir, 'ffmpeg'), ffprobe: join(binaries.ffmpegDir, 'ffprobe') };
}
