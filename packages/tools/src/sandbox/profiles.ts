// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which profile a run gets and the `-D` params it is given. The profiles are
 * files next to this module (src/sandbox/profiles); a bundled app copies them
 * and passes their folder as `profilesDir`.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE, TMP_DIR } from './paths';
import { fetcherFfmpeg, MAX_INPUTS, type PreparedRun } from './validate';

export const PROFILE_FILES = { offline: 'offline.sb', fetcher: 'fetcher.sb' } as const;
/** Where unused params point: a literal nobody can use to read or run anything. */
const UNUSED = '/dev/null';

export function defaultProfilesDir(): string {
  return fileURLToPath(new URL('./profiles/', import.meta.url));
}

export function profilePath(profilesDir: string, profile: PreparedRun['profile']): string {
  return join(profilesDir, PROFILE_FILES[profile]);
}

/** The params, in a fixed order, for `sandbox-exec -D NAME=value`. All paths are real paths. */
export function profileParams(
  run: PreparedRun,
  context: { readonly dir: string; readonly home: string },
): [string, string][] {
  const common: [string, string][] = [
    ['SCRATCH', context.dir],
    ['MANIFEST', join(context.dir, MANIFEST_FILE)],
    ['HOME', context.home],
    ['PROGRAM', run.program],
    ['PROGRAM_DIR', dirname(run.program)],
  ];
  if (run.profile === 'offline') {
    const inputs: [string, string][] = Array.from({ length: MAX_INPUTS }, (_, i) => [
      `INPUT_${i}`,
      run.inputs[i] ?? UNUSED,
    ]);
    return [...common, ...inputs];
  }
  const fetcher = run.fetcher!;
  const { ffmpeg, ffprobe } = fetcherFfmpeg(fetcher);
  const components: [string, string][] = Array.from({ length: 4 }, (_, i) => [
    `COMPONENT_${i}`,
    fetcher.componentDirs[i] ?? UNUSED,
  ]);
  return [
    ...common,
    ['TMPDIR', join(context.dir, TMP_DIR)],
    ['DENO', fetcher.deno],
    ['DENO_HOME', dirname(fetcher.deno)],
    ['FFMPEG', ffmpeg],
    ['FFPROBE', ffprobe],
    ['FFMPEG_DIR', fetcher.ffmpegDir],
    ...components,
  ];
}

/** The child's whole environment: nothing from ours leaks in. */
export function childEnv(run: PreparedRun, dir: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin',
    TMPDIR: join(dir, TMP_DIR),
    LANG: 'en_US.UTF-8',
  };
  if (run.profile === 'fetcher') env.DENO_DIR = join(dir, TMP_DIR, 'deno');
  return env;
}
