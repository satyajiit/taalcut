// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a Rust binary links, read from its Cargo.lock: `cargo tree` for the package and target over normal edges
 * without procedural macros (they run at build time and link nothing), joined with `cargo metadata` for each crate's
 * folder, licence expression, `links` key and build dependencies. Cargo fetches every crate itself and checks it
 * against the sha256 the Cargo.lock names; a CARGO_HOME of the caller's keeps those downloads apart.
 */
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { byteOrder } from '../hosting/files.mjs';

const exec = promisify(execFile);
const MAX_OUTPUT = 512 * 1024 * 1024;

/** A file that carries a licence or a notice, by name. */
export const LICENCE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._].*)?$/i;

/** Build dependencies that mean a crate compiles or links native code into the binary. */
const NATIVE_BUILD = new Set(['autotools', 'bindgen', 'cc', 'cmake', 'nasm-rs', 'openssl-src']);

/** Folders inside a crate whose files never reach the binary. */
const NOT_SHIPPED = /^(\.git|benches?|examples?|fixtures|node_modules|testdata|tests?)$/;

/** `cargo tree --prefix none --format {p}` output → [{ name, version }], once each, in order of first sight. */
export function parseTree(text) {
  const seen = new Map();
  for (const line of text.split('\n')) {
    const match = /^(\S+) v(\S+)/.exec(line.trim());
    if (match) seen.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
  }
  return [...seen.values()];
}

/**
 * The crates of `tree` (parseTree), the root package included (its own code is linked too), each with what the
 * notice needs from `metadata`: { name, version, license, links, dir, registry (false for a path crate),
 * repository, authors, nativeBuild (its native build dependencies) }. Sorted by name, then version.
 */
export function linkedCrates(metadata, tree) {
  const byKey = new Map();
  for (const pkg of metadata.packages) {
    const key = `${pkg.name}@${pkg.version}`;
    byKey.set(key, [...(byKey.get(key) ?? []), pkg]);
  }
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const names = new Map(metadata.packages.map((pkg) => [pkg.id, pkg.name]));
  return tree
    .map(({ name, version }) => {
      const found = byKey.get(`${name}@${version}`) ?? [];
      if (found.length !== 1)
        throw new Error(`${name} ${version}: ${found.length} packages in cargo metadata`);
      const [pkg] = found;
      const buildDeps = (nodes.get(pkg.id)?.deps ?? [])
        .filter((dep) => dep.dep_kinds.some((kind) => kind.kind === 'build'))
        .map((dep) => names.get(dep.pkg));
      return {
        name,
        version,
        license: pkg.license ?? null,
        links: pkg.links ?? null,
        dir: dirname(pkg.manifest_path),
        registry: pkg.source !== null,
        repository: pkg.repository ?? null,
        authors: pkg.authors ?? [],
        nativeBuild: [...new Set(buildDeps.filter((dep) => NATIVE_BUILD.has(dep)))].sort(byteOrder),
      };
    })
    .sort((a, b) => byteOrder(a.name, b.name) || byteOrder(a.version, b.version));
}

/** A crate that compiles or links native code: it has a `links` key or a native build dependency. */
export const isNative = (crate) => crate.links !== null || crate.nativeBuild.length > 0;

/**
 * Runs cargo in `dir` (a workspace with its Cargo.lock) and returns linkedCrates for `root` on `target`. `env` adds
 * to the environment (CARGO_HOME; RUSTC_BOOTSTRAP for the standard library's own workspace); `features` are
 * passed to `cargo tree`.
 */
export async function cargoCrates(dir, { root, target, env = {}, features = [] }) {
  const options = { cwd: dir, env: { ...process.env, ...env }, maxBuffer: MAX_OUTPUT };
  const metadata = await exec(
    'cargo',
    // Every feature, so the lookup also has the optional crates `cargo tree`'s features turn on.
    ['metadata', '--format-version', '1', '--locked', '--all-features', '--filter-platform', target],
    options,
  );
  const featureArgs = features.length > 0 ? ['--features', features.join(',')] : [];
  const tree = await exec(
    'cargo',
    [
      ...['tree', '-p', root, '--locked', '--offline', '--target', target],
      ...['-e', 'normal,no-proc-macro', '--prefix', 'none', '--format', '{p}', ...featureArgs],
    ],
    options,
  );
  return linkedCrates(JSON.parse(metadata.stdout), parseTree(tree.stdout));
}

/** The licence files directly in `dir`, sorted. */
export async function licenceFilesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort(byteOrder);
}

/** Every licence file under `dir` but in folders that never ship (tests, benches, examples…), as relative paths. */
export async function nestedLicenceFiles(dir, prefix = '') {
  const found = [];
  const entries = (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) =>
    byteOrder(a.name, b.name),
  );
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !NOT_SHIPPED.test(entry.name))
      found.push(...(await nestedLicenceFiles(dir, path)));
    else if (entry.isFile() && prefix && LICENCE_FILE.test(entry.name)) found.push(path);
  }
  return found;
}
