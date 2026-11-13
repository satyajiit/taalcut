// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Arguments for the two programs that aren't FFmpeg: the mac helper (its
 * `ocr` subcommand only) and yt-dlp (the reference fetcher's fixed flag set,
 * one https link). The caller passes `deno` and `ffmpeg` as the values of
 * `--js-runtimes` and `--ffmpeg-location`; the sandbox puts in the bundled
 * paths, so nothing outside it chooses which binaries yt-dlp runs.
 */
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { SandboxArgumentRejected } from './errors';
import { COOKIES_FILE, SCRATCH_PREFIX } from './paths';
import type { ArgumentPaths, PreparedArgs } from './validate-ffmpeg';

const reject = (index: number, reason: string) => err(SandboxArgumentRejected({ index, reason }));
const LANGUAGES = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*(?:,[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*){0,7}$/;

/** `ocr --input scratch:… [--languages …] [--fast]`. */
export async function prepareMacHelperArgs(
  args: readonly string[],
  context: { readonly paths: ArgumentPaths },
): AsyncResult<PreparedArgs> {
  if (args[0] !== 'ocr') return reject(0, 'only the ocr subcommand');
  const out = ['ocr'];
  let input = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--fast') {
      out.push(arg);
    } else if (arg === '--languages') {
      const value = args[i + 1];
      if (value === undefined || !LANGUAGES.test(value)) return reject(i + 1, 'bad languages');
      out.push(arg, value);
      i++;
    } else if (arg === '--input' && !input) {
      const value = args[i + 1];
      if (value === undefined || !value.startsWith('scratch:'))
        return reject(i + 1, 'input must be scratch:');
      const file = await context.paths.readFile(value, i + 1);
      if (!file.ok) return file;
      out.push(arg, file.value);
      input = true;
      i++;
    } else {
      return reject(i, 'option not allowed');
    }
  }
  return input ? ok({ args: out }) : reject(args.length, 'missing --input');
}

/** The fetcher's binaries, resolved when a fetch runs (the component may install on first use). */
export interface FetcherBinaries {
  readonly binary: string;
  readonly deno: string;
  /** The bundled LGPL FFmpeg's folder: yt-dlp merges with it and finds ffprobe beside it. */
  readonly ffmpegDir: string;
  /** Folders the fetcher may read (the components' install folders). At most four. */
  readonly componentDirs: readonly string[];
}

type FlagRule = { readonly value?: (value: string) => boolean };
const int = (max: number) => (value: string) => /^\d{1,6}$/.test(value) && Number(value) <= max;
const template = (value: string) => value.length > 0 && value.length <= 1000 && !/[\r\n\0]/.test(value);

/** Exactly the reference fetcher's options (research note, "Flags"); everything else is refused. */
const YT_DLP_FLAGS: Readonly<Record<string, FlagRule>> = {
  '--ignore-config': {},
  '--no-plugin-dirs': {},
  '--no-update': {},
  '--no-cache-dir': {},
  '--no-playlist': {},
  '--no-mtime': {},
  '--newline': {},
  '--progress': {},
  '--js-runtimes': { value: (value) => value === 'deno' },
  '--ffmpeg-location': { value: (value) => value === 'ffmpeg' },
  '--max-downloads': { value: int(1) },
  // Only the source-import policy; never expose yt-dlp's arbitrary filter expression language to an agent.
  '--match-filters': { value: (value) => value === 'duration <= 14400 & !is_live' },
  '-f': { value: (value) => /^[A-Za-z0-9*[\]<>=+/ .:_-]{1,200}$/.test(value) },
  '--merge-output-format': { value: (value) => ['mp4', 'mkv', 'webm'].includes(value) },
  '--max-filesize': { value: (value) => /^\d{1,4}[KMG]?$/.test(value) },
  '--socket-timeout': { value: int(120) },
  '--retries': { value: int(10) },
  '--fragment-retries': { value: int(10) },
  '--progress-template': { value: template },
  '--print': { value: template },
  '--cookies': { value: (value) => value === `${SCRATCH_PREFIX}${COOKIES_FILE}` },
  '-o': { value: (value) => value.startsWith(SCRATCH_PREFIX) },
};
const REQUIRED = ['--ignore-config', '--no-plugin-dirs', '--no-update', '--no-cache-dir', '-o'];

function httpsLink(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** yt-dlp's argv with the bundled paths in, or why the request can't run. */
export async function prepareYtDlpArgs(
  args: readonly string[],
  context: {
    readonly dir?: string;
    readonly paths: ArgumentPaths;
    readonly binaries: FetcherBinaries;
  },
): AsyncResult<PreparedArgs> {
  const out: string[] = [];
  const seen = new Set<string>();
  const end = args.indexOf('--');
  if (end < 0 || end !== args.length - 2) return reject(args.length, 'one link after --');
  if (!httpsLink(args[end + 1]!)) return reject(end + 1, 'link must be https');
  for (let i = 0; i < end; i++) {
    const flag = args[i]!;
    const rule = YT_DLP_FLAGS[flag];
    if (!rule) return reject(i, 'option not allowed');
    seen.add(flag);
    if (!rule.value) {
      out.push(flag);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || i + 1 >= end || !rule.value(value)) return reject(i + 1, 'bad value');
    const resolved = await valueFor(flag, value, i + 1, context);
    if (!resolved.ok) return resolved;
    out.push(flag, resolved.value);
    i++;
  }
  for (const flag of REQUIRED) if (!seen.has(flag)) return reject(args.length, `missing ${flag}`);
  return ok({ args: [...out, '--', args[end + 1]!] });
}

async function valueFor(
  flag: string,
  value: string,
  index: number,
  context: {
    readonly dir?: string;
    readonly paths: ArgumentPaths;
    readonly binaries: FetcherBinaries;
  },
): AsyncResult<string> {
  if (flag === '--js-runtimes') return ok(`deno:${context.binaries.deno}`);
  if (flag === '--ffmpeg-location') return ok(context.binaries.ffmpegDir);
  if (flag === '--cookies') {
    if (!context.dir) return context.paths.readFile(value, index);
    const cookiePath = join(context.dir, COOKIES_FILE);
    const info = await lstat(cookiePath).catch(() => null);
    return info?.isFile() ? ok(cookiePath) : reject(index, 'no such file');
  }
  if (flag === '-o') return context.paths.writeFile(value, index);
  return ok(value);
}

/** Checks that `program` may use the network as asked: only the fetcher goes online. */
export function networkProblem(program: string, network: 'none' | 'outbound'): Result<void> {
  if (program === 'ytDlp' && network !== 'outbound')
    return reject(-1, 'the fetcher runs with network outbound');
  if (program !== 'ytDlp' && network !== 'none') return reject(-1, 'only the fetcher may use the network');
  return ok(undefined);
}
