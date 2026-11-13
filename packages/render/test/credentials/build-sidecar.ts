// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Global setup of the Content Credentials project (vitest.config.ts): builds the real `taalcut-c2pa` sidecar once,
 * before any test of that project runs, so no test hook compiles. A hash of the crate's inputs (Cargo.toml,
 * Cargo.lock, src/, certs/, which the binary embeds) is kept beside the binary; a run whose hash matches uses the
 * binary as it is, without cargo. The tests get its path with `inject('c2paSidecar')`. TAALCUT_C2PA_SIDECAR names
 * a prebuilt one instead, and nothing is built.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { TestProject } from 'vitest/node';
import { C2PA_SIDECAR } from '../../src/credentials/sidecar';
import { C2PA_SIDECAR_ENV } from '../../src/credentials/sidecar-path';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The `taalcut-c2pa` binary the tests start: built here, or TAALCUT_C2PA_SIDECAR's. */
    c2paSidecar: string;
  }
}

const CRATE = join(import.meta.dirname, '..', '..', '..', '..', 'native', 'c2pa-sidecar');
/** What the build reads: its manifest and lockfile, the sources, and the test certificate it embeds. */
const INPUTS = ['Cargo.toml', 'Cargo.lock', 'src', 'certs'];

/** Every file under `path` (or `path` itself), sorted. */
function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => filesUnder(join(path, name)));
}

/** The sha256 of the crate's inputs: each file's path from the crate and its bytes. */
export function crateInputHash(crate: string = CRATE): string {
  const hash = createHash('sha256');
  for (const file of INPUTS.flatMap((input) => filesUnder(join(crate, input)))) {
    hash.update(relative(crate, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export default function setup(project: TestProject): void {
  const explicit = process.env[C2PA_SIDECAR_ENV];
  if (explicit) {
    project.provide('c2paSidecar', explicit);
    return;
  }
  const binary = join(CRATE, 'target', 'release', C2PA_SIDECAR.binary);
  const stamp = `${binary}.inputs`;
  const inputs = crateInputHash();
  const current = existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8') === inputs;
  if (!current) {
    const build = spawnSync('cargo', ['build', '--release', '--locked'], { cwd: CRATE, stdio: 'inherit' });
    if (build.error || build.status !== 0)
      throw new Error(
        `Building native/c2pa-sidecar failed (is cargo installed?): ${build.error?.message ?? build.status}`,
      );
    if (!existsSync(binary))
      throw new Error(`cargo built, but ${C2PA_SIDECAR.binary} is not in target/release`);
    writeFileSync(stamp, inputs);
  }
  project.provide('c2paSidecar', binary);
}
