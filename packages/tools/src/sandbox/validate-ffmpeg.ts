// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns an experiment's FFmpeg or ffprobe arguments into the argv that runs:
 * every option from the allow-list, every input a `file:` path (scratch or a
 * granted input) behind `-protocol_whitelist file` and the demuxer allow-list
 * (or a generator-only lavfi graph), every filter graph checked, every output
 * a scratch path or stdout for a few muxers, and the thread count forced to
 * the limit. Errors carry the index of the caller's argument.
 */
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { SandboxArgumentRejected } from './errors';
import {
  FFMPEG_OPTIONS,
  FFPROBE_OPTIONS,
  INPUT_DEMUXERS,
  LOG_LEVELS,
  OUTPUT_EXTENSIONS,
  OUTPUT_MUXERS,
  STDOUT_MUXERS,
  splitOption,
  type OptionRule,
} from './ffmpeg-options';
import { filterGraphProblem } from './filtergraph';

/** Resolves `scratch:` and `input:` arguments for one experiment. */
export interface ArgumentPaths {
  /** An existing file in the experiment, as an absolute real path. */
  readFile(arg: string, index: number): AsyncResult<string>;
  /** A path the child may create in the experiment; its parent folders are made before the run. */
  writeFile(arg: string, index: number): AsyncResult<string>;
  /** True when the argument names an input or scratch path at all. */
  isPath(arg: string): boolean;
}

export interface PreparedArgs {
  readonly args: string[];
}

interface Pending {
  readonly name: string;
  readonly value?: string;
  readonly index: number;
  readonly rule: OptionRule;
}

const reject = (index: number, reason: string) => err(SandboxArgumentRejected({ index, reason }));
const QUIET = new Set(LOG_LEVELS.slice(0, LOG_LEVELS.indexOf('info')));

function emit(options: readonly Pending[]): string[] {
  return options.flatMap((option) =>
    option.value === undefined ? [`-${option.name}`] : [`-${option.name}`, option.value],
  );
}

/** Reads one option at `index`; returns it, or why not. */
function readOption(
  table: Readonly<Record<string, OptionRule>>,
  args: readonly string[],
  index: number,
): Result<Pending> {
  const parsed = splitOption(args[index]!.slice(1));
  const rule = parsed ? table[parsed.base] : undefined;
  if (!parsed || !rule) return reject(index, 'option not allowed');
  if (parsed.specifier !== null && !rule.specifier) return reject(index, 'stream specifier not allowed');
  if (rule.arity === 0) return ok({ name: args[index]!.slice(1), index, rule });
  const value = args[index + 1];
  if (value === undefined) return reject(index, 'missing value');
  const problem = rule.check?.(value) ?? null;
  if (problem) return reject(index + 1, problem);
  if (rule.kind === 'filter') {
    const graph = filterGraphProblem(value);
    if (graph) return reject(index + 1, graph);
  }
  return ok({ name: args[index]!.slice(1), value, index, rule });
}

function loglevelOf(options: readonly Pending[]): string | undefined {
  return options.find((option) => option.rule.kind === 'loglevel')?.value;
}

/** Keeps the caller's level unless it would hide FFmpeg's "received signal 24" (the CPU limit's only trace). */
function loglevel(options: readonly Pending[]): string[] {
  const level = loglevelOf(options);
  const base = level?.replace(/^(?:(?:level|repeat)\+)*/, '');
  return ['-loglevel', level === undefined || QUIET.has(base!) ? 'info' : level];
}

const isOutputArg = (arg: string) => arg === '-' || !arg.startsWith('-');

/** FFmpeg: `[global] {[input options] -i input}… {[output options] output}…`. */
export async function prepareFfmpegArgs(
  args: readonly string[],
  context: { readonly paths: ArgumentPaths; readonly threads: number },
): AsyncResult<PreparedArgs> {
  const { paths, threads } = context;
  const global: Pending[] = [];
  const inputs: string[][] = [];
  const outputs: string[][] = [];
  let pending: Pending[] = [];
  const thread = ['-threads', String(threads)];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-i') {
      const input = args[i + 1];
      if (input === undefined) return reject(i, 'missing input');
      const format = pending.find((option) => option.rule.kind === 'format')?.value;
      const own = pending.filter((option) => option.rule.kind !== 'threads');
      for (const option of own)
        if (option.rule.scope === 'output') return reject(option.index, 'output option before an input');
      if (format === 'lavfi') {
        const problem = filterGraphProblem(input, { lavfiInput: true });
        if (problem) return reject(i + 1, problem);
        inputs.push([...emit(own), ...thread, '-i', input]);
      } else {
        if (format !== undefined && !(INPUT_DEMUXERS as readonly string[]).includes(format))
          return reject(
            own.find((option) => option.rule.kind === 'format')!.index + 1,
            'demuxer not allowed',
          );
        if (!paths.isPath(input)) return reject(i + 1, 'input must be a scratch: or input: path');
        const file = await paths.readFile(input, i + 1);
        if (!file.ok) return file;
        const whitelist = ['-protocol_whitelist', 'file', '-format_whitelist', INPUT_DEMUXERS.join(',')];
        inputs.push([...emit(own), ...thread, ...whitelist, '-i', `file:${file.value}`]);
      }
      pending = [];
      i++;
      continue;
    }
    if (isOutputArg(arg)) {
      const output = await prepareOutput(arg, i, pending, paths);
      if (!output.ok) return output;
      outputs.push([...output.value, ...thread]);
      pending = [];
      continue;
    }
    const option = readOption(FFMPEG_OPTIONS, args, i);
    if (!option.ok) return option;
    i += option.value.rule.arity;
    if (option.value.rule.scope === 'global') global.push(option.value);
    else pending.push(option.value);
  }
  if (pending.length > 0) return reject(pending[0]!.index, 'option after the last output');
  if (outputs.length === 0) return reject(args.length, 'no output');
  const kept = global.filter((option) => option.rule.kind !== 'loglevel' && option.rule.kind !== 'threads');
  const forced = ['-nostdin', ...loglevel(global), '-filter_threads', String(threads)];
  const complex = kept.some((option) => option.name === 'filter_complex' || option.name === 'lavfi');
  const complexThreads = complex ? ['-filter_complex_threads', String(threads)] : [];
  return ok({
    args: [...forced, ...complexThreads, ...emit(kept), ...inputs.flat(), ...outputs.flat()],
  });
}

async function prepareOutput(
  arg: string,
  index: number,
  pending: readonly Pending[],
  paths: ArgumentPaths,
): AsyncResult<string[]> {
  const options = pending.filter((option) => option.rule.kind !== 'threads');
  for (const option of options)
    if (option.rule.scope === 'input') return reject(option.index, 'input option before an output');
  const formatOption = options.find((option) => option.rule.kind === 'format');
  const format = formatOption?.value;
  if (format !== undefined && !(OUTPUT_MUXERS as readonly string[]).includes(format))
    return reject(formatOption!.index + 1, 'muxer not allowed');
  if (arg === '-') {
    if (format === undefined || !STDOUT_MUXERS.includes(format))
      return reject(index, 'stdout needs -f with a stream muxer');
    return ok([...emit(options), 'pipe:1']);
  }
  if (!paths.isPath(arg) || !arg.startsWith('scratch:'))
    return reject(index, 'output must be a scratch: path');
  if (format === undefined) {
    const extension = /\.([A-Za-z0-9]+)$/.exec(arg)?.[1]?.toLowerCase();
    if (!extension || !OUTPUT_EXTENSIONS.includes(extension))
      return reject(index, 'output needs -f or a known extension');
  }
  const file = await paths.writeFile(arg, index);
  if (!file.ok) return file;
  return ok([...emit(options), `file:${file.value}`]);
}

/** ffprobe: options and exactly one input; it writes nothing but stdout. */
export async function prepareFfprobeArgs(
  args: readonly string[],
  context: { readonly paths: ArgumentPaths },
): AsyncResult<PreparedArgs> {
  const options: Pending[] = [];
  let input: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const isInput = arg === '-i' || !arg.startsWith('-');
    if (isInput) {
      const at = arg === '-i' ? i + 1 : i;
      const value = args[at];
      if (value === undefined) return reject(i, 'missing input');
      if (input !== undefined) return reject(at, 'one input only');
      if (!context.paths.isPath(value)) return reject(at, 'input must be a scratch: or input: path');
      const file = await context.paths.readFile(value, at);
      if (!file.ok) return file;
      input = file.value;
      i = at;
      continue;
    }
    const option = readOption(FFPROBE_OPTIONS, args, i);
    if (!option.ok) return option;
    if (
      option.value.rule.kind === 'format' &&
      !(INPUT_DEMUXERS as readonly string[]).includes(option.value.value!)
    )
      return reject(i + 1, 'demuxer not allowed');
    options.push(option.value);
    i += option.value.rule.arity;
  }
  if (input === undefined) return reject(args.length, 'no input');
  const whitelist = ['-protocol_whitelist', 'file', '-format_whitelist', INPUT_DEMUXERS.join(',')];
  return ok({ args: [...emit(options), ...whitelist, '-i', `file:${input}`] });
}
