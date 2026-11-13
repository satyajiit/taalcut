// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the workspace shell's tools run on (AGT2 sbx), and what they share: the project's workspace store (HFW1's,
 * through core's port), the shell folders' root, the runner (job mode in the agent process), and how a library
 * asset's media file is found. They join render's `workspace` module in the composition root (desktop), so the
 * Designer's and the shell's tools are one workspace.
 */
import { constants as fsc } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  ok,
  ulidSchema,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type WorkspaceStore,
} from '@taalcut/core';
import { relativeProblem } from '../sandbox/paths';
import type { ShellRunner } from './shell-runner';
import type { ToolchainReport } from './toolchain-job';

export interface ShellToolDeps {
  readonly store: WorkspaceStore;
  /** `<userData>/shell`: the root the runner uses too. */
  readonly root: string;
  readonly runner: ShellRunner;
  /** A library asset's media file, to clone into inputs/. */
  readonly resolveInput: (assetId: AssetId) => AsyncResult<string>;
  /**
   * What the shell has on PATH (names and versions) and what it lacks, installing the toolchain's components on
   * first use: the `workspace.toolchain` job in the agent process.
   */
  readonly toolchain?: (signal: AbortSignal) => AsyncResult<ToolchainReport>;
  readonly clock?: () => number;
}

// 1.0.0 (AGT2 sbx): the workspace shell's tools.
export const SHELL_TOOLS_VERSION = '1.0.0';

/** Ids as plain ULID strings (core's ulidSchema): tool schemas must export to JSON Schema. */
export const projectIdInput = ulidSchema('Project').describe('The project whose workspace this is');

/**
 * A path inside the shell folder that trusted code may read: relative, no `..`, not the manifest, tmp/ or home/;
 * its real path inside the folder. Null when it leaves the folder or isn't there.
 */
export async function shellPath(folder: string, rel: string): AsyncResult<string> {
  const problem = relativeProblem(rel);
  const top = rel.split('/')[0];
  if (problem || top === 'shell.json' || top === 'tmp' || top === 'home')
    return err(ValidationError({ field: 'path' }, { detail: problem ?? `${rel} isn't the agent's to read` }));
  const real = await realpath(join(folder, rel)).catch(() => null);
  if (!real || !(real === folder || real.startsWith(`${folder}/`)))
    return err(ValidationError({ field: 'path' }, { detail: `No ${rel} in the workspace folder` }));
  return ok(real);
}

/** A plain file's bytes (one link, opened without following, at most `max`), or why not. */
export async function readPlain(path: string, max: number): AsyncResult<Uint8Array> {
  const walked = await lstat(path).catch(() => null);
  if (!walked?.isFile()) return err(ValidationError({ field: 'path' }, { detail: 'Not a regular file' }));
  if (walked.size > max)
    return err(
      ValidationError({ field: 'path' }, { detail: `${walked.size} bytes; at most ${max} can be read` }),
    );
  const handle = await open(path, fsc.O_RDONLY | fsc.O_NOFOLLOW).catch(() => null);
  if (!handle) return err(ValidationError({ field: 'path' }, { detail: 'It could not be opened' }));
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || facts.nlink !== 1 || facts.ino !== walked.ino)
      return err(
        ValidationError({ field: 'path' }, { detail: 'Not a plain file (a hard link, or it changed)' }),
      );
    return ok(new Uint8Array(await handle.readFile()));
  } finally {
    await handle.close();
  }
}

/** The media type of an image the agent may look at, by its first bytes; null for anything else. */
export function imageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  const ascii = (from: number, to: number) => Buffer.from(bytes.subarray(from, to)).toString('latin1');
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  return null;
}
