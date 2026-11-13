// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Core ML shot model's helper from a checkout (native/mac-helper/build.sh, or TAALCUT_MAC_HELPER), for the
 * evals, the benches and the parity test (IX2-S10). The app resolves its own pinned helper (apps/desktop
 * vision.ts).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { createJsonLineSidecar, createSidecarResolver } from '@taalcut/media';
import { shotsServeArgs, type ShotsHelper } from './coreml-model';

/**
 * The development helper's shots service, its windows written into `windowsDir` (a folder the caller made and
 * removes, symlinks resolved), or why there is no helper.
 */
export async function developmentShotsHelper(
  windowsDir: () => Promise<string>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AsyncResult<ShotsHelper> {
  const found = await createSidecarResolver({
    name: 'taalcut-mac-helper',
    development: true,
    pin: '',
    env,
  }).resolve();
  if (!found.ok) return found;
  const command = found.value.path;
  return ok({
    windowsDir,
    start: async (modelsDir, dir) =>
      ok(createJsonLineSidecar({ command, args: shotsServeArgs(modelsDir, dir) })),
  });
}
