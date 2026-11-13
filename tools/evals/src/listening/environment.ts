// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the listening suites need from the machine, found without downloading anything, and the reason a suite
 * skips when it isn't here:
 *
 * - the listen models: `TAALCUT_EAR1_MODELS`, a folder of unpacked component builds (tools/components/listen), in
 *   the dtype `TAALCUT_LISTEN_DTYPE` asks for (fp16, the Metal build, by default; int8 runs on the CPU);
 * - FFmpeg: the app's build (TAALCUT_FFMPEG_DIR, else tools/ffmpeg/dist), as media finds it in a checkout.
 */
import { directoryListenFiles, type ListenModelName } from '@taalcut/audio';
import { createBinaryResolver, type ResolvedFfmpeg } from '@taalcut/media';

export type ListenDtype = 'fp16' | 'int8';

export interface ListenModelsHere {
  readonly root: string;
  readonly dtype: ListenDtype;
}

/** Either what was found, or why the part that needs it is skipped. */
export type Found<T> = { readonly found: T } | { readonly reason: string };

export const expandHome = (path: string): string => path.replace(/^~(?=\/)/, process.env.HOME ?? '~');

export function listenDtype(env: NodeJS.ProcessEnv = process.env): ListenDtype {
  return env.TAALCUT_LISTEN_DTYPE === 'int8' ? 'int8' : 'fp16';
}

/** The unpacked models `names` need, in the dtype asked for; the reason names the first one missing. */
export async function listenModelsHere(
  names: readonly ListenModelName[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Found<ListenModelsHere>> {
  const root = env.TAALCUT_EAR1_MODELS?.trim();
  if (!root) return { reason: 'no listen models: TAALCUT_EAR1_MODELS is not set' };
  const dtype = listenDtype(env);
  const files = directoryListenFiles(expandHome(root), dtype);
  for (const name of names) {
    if (!(await files.resolve(name)).ok) {
      return { reason: `no ${dtype} ${name} model under ${root} (TAALCUT_EAR1_MODELS)` };
    }
  }
  return { found: { root: expandHome(root), dtype } };
}

/** The app's FFmpeg build, checked against its build info. */
export async function ffmpegHere(): Promise<Found<ResolvedFfmpeg>> {
  const resolved = await createBinaryResolver({ development: true }).resolve();
  return resolved.ok
    ? { found: resolved.value }
    : { reason: `no FFmpeg build (${resolved.error.code}): run tools/ffmpeg/build.sh` };
}

/** fp16 runs on Metal through WebGPU, falling back to the CPU; int8 is the CPU build (the machine fit's choice). */
export const LISTEN_DEVICES = { fp16: ['webgpu', 'cpu'], int8: ['cpu'] } as const;
