// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The macOS backend (AGT2 sbx): `/usr/bin/sandbox-exec` (never one found on PATH) with workspace.sb, the
 * deny-by-default profile beside the experiment sandbox's (src/sandbox/profiles). A bundled app copies the
 * profiles and passes their folder.
 */
import { access, constants as fsc } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { SandboxUnavailable } from '../sandbox/errors';
import { defaultProfilesDir } from '../sandbox/profiles';
import type { ShellBackend } from './backend';
import { shellProfileParams } from './folder';

export const SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';
export const WORKSPACE_PROFILE = 'workspace.sb';

export interface SeatbeltOptions {
  readonly sandboxExec?: string;
  /** Where workspace.sb is. Default: next to this package's source. */
  readonly profilesDir?: string;
}

const usableCache = new Map<string, boolean>();

async function usable(path: string, mode: number): Promise<boolean> {
  const key = `${path}:${mode}`;
  const cached = usableCache.get(key);
  if (cached !== undefined) return cached;
  const okAccess = await access(path, mode).then(
    () => true,
    () => false,
  );
  if (okAccess) usableCache.set(key, true);
  return okAccess;
}

/** The backend for one folder, or `sandbox.unavailable` when sandbox-exec or the profile is missing. */
export async function seatbeltBackend(
  folder: string,
  toolRoots: readonly string[],
  ports: readonly number[],
  options: SeatbeltOptions = {},
): AsyncResult<ShellBackend> {
  const sandboxExec = options.sandboxExec ?? SANDBOX_EXEC_PATH;
  const profile = join(options.profilesDir ?? defaultProfilesDir(), WORKSPACE_PROFILE);
  if (!(await usable(sandboxExec, fsc.X_OK)))
    return err(SandboxUnavailable(undefined, { detail: `${sandboxExec} is missing` }));
  if (!(await usable(profile, fsc.R_OK)))
    return err(SandboxUnavailable(undefined, { detail: `${WORKSPACE_PROFILE} is missing` }));
  return ok({ kind: 'seatbelt', sandboxExec, profile, params: shellProfileParams(folder, toolRoots, ports) });
}
