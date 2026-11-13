// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where `taalcut-c2pa` comes from, in order: an explicit path (TAALCUT_C2PA_SIDECAR in development, or a
 * test's), the installed `c2pa-sidecar` component, then a checkout's own build under native/c2pa-sidecar.
 * And how to start it: one JSON-lines process whose `--allow-root`s are the folders main lets it touch.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, type Result } from '@taalcut/core';
import { createJsonLineSidecar } from '@taalcut/media';
import { CredentialsUnavailable } from '../errors-phase3';
import { C2PA_SIDECAR, createC2paSidecarClient, type C2paSidecar } from './sidecar';

/** The environment variable a development run may point at a built sidecar. */
export const C2PA_SIDECAR_ENV = 'TAALCUT_C2PA_SIDECAR';

export interface C2paSidecarSources {
  readonly explicit?: string;
  /** The installed component's folder (the archive holds the binary at its top). */
  readonly componentDir?: string;
  /** A checkout: also look in native/c2pa-sidecar/dist and target/release. */
  readonly development: boolean;
  /** The repository root, for the development copies. */
  readonly repoDir?: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function c2paSidecarCandidates(sources: C2paSidecarSources): string[] {
  const candidates: string[] = [];
  if (sources.explicit) candidates.push(sources.explicit);
  if (sources.componentDir) candidates.push(join(sources.componentDir, C2PA_SIDECAR.binary));
  if (sources.development && sources.repoDir) {
    const crate = join(sources.repoDir, 'native', 'c2pa-sidecar');
    candidates.push(
      join(crate, 'dist', C2PA_SIDECAR.binary),
      join(crate, 'target', 'release', C2PA_SIDECAR.binary),
    );
  }
  return candidates;
}

/** The first candidate on disk; render.credentials_unavailable otherwise (the component isn't installed). */
export function resolveC2paSidecar(sources: C2paSidecarSources): Result<string> {
  const candidates = c2paSidecarCandidates(sources);
  const found = candidates.find(isFile);
  return found
    ? ok(found)
    : err(
        CredentialsUnavailable(undefined, {
          detail: `No ${C2PA_SIDECAR.binary}; looked in ${candidates.length} places`,
        }),
      );
}

/** The command line: `serve` with one `--allow-root` per folder (render's work folder, the library roots). */
export function c2paSidecarArgs(allowRoots: readonly string[]): string[] {
  return ['serve', ...allowRoots.flatMap((root) => ['--allow-root', root])];
}

/** A client over a fresh sidecar process (started on the first request, restarted after a crash). */
export function startC2paSidecar(binary: string, allowRoots: readonly string[]): C2paSidecar {
  return createC2paSidecarClient(
    createJsonLineSidecar({ command: binary, args: c2paSidecarArgs(allowRoots) }),
  );
}
