// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the IX2 thumbnail and filmstrip benches share: every FFmpeg run of a
 * context timed by `/usr/bin/time -p` into one file (wall from the caller,
 * CPU as user + sys of every run), medians, and a file's plan.
 */
import { readFile, stat } from 'node:fs/promises';
import * as media from '@taalcut/media';

export const median = (xs: readonly number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** `base`, with every process it starts run under `/usr/bin/time -a -p -o timeFile`. */
export function timedContext(base: media.MediaContext, timeFile: string): media.MediaContext {
  const inner = base.runner ?? media.runProcess;
  return {
    ...base,
    runner: (command, args, options) =>
      inner('/usr/bin/time', ['-a', '-p', '-o', timeFile, command, ...args], options),
  };
}

/** User + sys over every run `/usr/bin/time` recorded in `timeFile`, and how many runs there were. */
export async function cpuOf(timeFile: string): Promise<{ readonly cpuMs: number; readonly runs: number }> {
  const text = await readFile(timeFile, 'utf8');
  let cpu = 0;
  let runs = 0;
  for (const line of text.split('\n')) {
    const [name, value] = line.trim().split(/\s+/);
    if (name === 'real') runs++;
    if ((name === 'user' || name === 'sys') && value) cpu += Number(value) * 1000;
  }
  return { cpuMs: Math.round(cpu), runs };
}

/** The development FFmpeg build, with a tone-map selection proven once for the whole bench. */
export async function benchContext(): Promise<media.MediaContext> {
  const binaries = await media.createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(binaries.error.code);
  return { binaries: binaries.value, toneMaps: new media.ToneMapSelection() };
}

export async function planFile(ctx: media.MediaContext, path: string): Promise<media.NormalisationPlan> {
  const probed = await media.probeMedia(path, ctx);
  if (!probed.ok) throw new Error(`${path}: ${probed.error.code}`);
  const plan = media.planNormalisation(probed.value, { sizeBytes: (await stat(path)).size });
  if (!plan.ok) throw new Error(`${path}: ${plan.error.code}`);
  return plan.value;
}
