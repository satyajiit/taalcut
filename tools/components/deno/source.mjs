// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two Cargo workspaces Deno's notice is read from: Deno's own at the pinned tag (its archive, by sha256), and the
 * standard library's from the rust-src of the toolchain Deno's rust-toolchain.toml names. Cargo's downloads go to
 * tools/components/.cache/cargo-home, never the user's ~/.cargo.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extract } from '../hosting/archive.mjs';
import { pinned } from '../hosting/pinned.mjs';
import { cargoCrates } from './cargo.mjs';
import { DENO, RUST_STD } from './pins.mjs';

const exec = promisify(execFile);

export const CARGO_HOME = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'cargo-home');

/** Cargo and rustc run with Deno's toolchain and the cache's CARGO_HOME. */
export const CARGO_ENV = { CARGO_HOME, RUSTUP_TOOLCHAIN: DENO.toolchain, CARGO_TERM_COLOR: 'never' };

/** Unpacks Deno's pinned source into `work` and returns its folder, after checking the toolchain it names. */
export async function denoSource(work, pinOptions) {
  const into = join(work, 'deno-source');
  await extract(await pinned(DENO.source, pinOptions), 'tar.gz', into);
  const [top] = await readdir(into);
  // Cargo reports real paths (/private/var/… for a temporary folder on macOS); so must this.
  const dir = await realpath(join(into, top));
  const toolchain = /^channel = "([^"]+)"/m.exec(
    await readFile(join(dir, 'rust-toolchain.toml'), 'utf8'),
  )?.[1];
  if (toolchain !== DENO.toolchain)
    throw new Error(`deno ${DENO.version} names toolchain ${toolchain}; pins.mjs says ${DENO.toolchain}`);
  return dir;
}

/** The standard library's workspace in that toolchain's rust-src (rustup installs it with the toolchain). */
export async function stdSource() {
  const { stdout } = await exec('rustc', ['--print', 'sysroot'], { env: { ...process.env, ...CARGO_ENV } });
  return realpath(join(stdout.trim(), 'lib', 'rustlib', 'src', 'rust', 'library'));
}

/** The crates deno links, and the standard library's, each as cargo.mjs's linkedCrates gives them. */
export async function linkedWorkspaces(work, pinOptions) {
  const deno = await denoSource(work, pinOptions);
  const std = await stdSource();
  return {
    deno,
    std,
    denoCrates: await cargoCrates(deno, { root: DENO.package, target: DENO.target, env: CARGO_ENV }),
    stdCrates: await cargoCrates(std, {
      root: RUST_STD.root,
      target: DENO.target,
      env: { ...CARGO_ENV, RUSTC_BOOTSTRAP: '1' },
      features: RUST_STD.features,
    }),
  };
}
