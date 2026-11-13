// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The licences of every crate a Rust binary links (c2pa-sidecar statically links ~200), for the notice shipped
 * inside its component: `cargo metadata` for the target platform, the normal (not build or dev) dependencies of
 * the root package without proc-macros (which run at build time and link nothing), and each crate's own licence
 * files from its source folder in cargo's registry.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { byteOrder } from './files.mjs';

const exec = promisify(execFile);
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

/** The packages linked into the root package's binary, sorted by name then version. The root is excluded. */
export function linkedPackages(metadata) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const isProcMacro = (pkg) => pkg.targets.some((target) => target.kind.includes('proc-macro'));
  const root = metadata.resolve.root;
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length > 0) {
    const node = nodes.get(stack.pop());
    for (const dep of node?.deps ?? []) {
      if (seen.has(dep.pkg) || !dep.dep_kinds.some((kind) => kind.kind === null)) continue;
      const pkg = packages.get(dep.pkg);
      if (!pkg || isProcMacro(pkg)) continue;
      seen.add(dep.pkg);
      stack.push(dep.pkg);
    }
  }
  seen.delete(root);
  return [...seen]
    .map((id) => packages.get(id))
    .sort((a, b) => byteOrder(a.name, b.name) || byteOrder(a.version, b.version));
}

/** The text for `packages`, given each one's licence files ([{ name, text }]). */
export function cratesNotice(packages, filesOf) {
  const lines = [
    'Crates statically linked into this binary, with their licences (cargo metadata, normal dependencies,',
    'no proc-macros). Each crate is used under its licence expression; where it offers a choice, Taalcut',
    'distributes it under the MIT or Apache-2.0 option the crate offers, or the first option otherwise.',
    '',
  ];
  for (const pkg of packages)
    lines.push(`${pkg.name} ${pkg.version}  ${pkg.license ?? '(no licence field)'}`);
  for (const pkg of packages) {
    const files = filesOf(pkg);
    if (files.length === 0) throw new Error(`${pkg.name} ${pkg.version}: no licence file in its source`);
    for (const file of files) {
      lines.push('', `---- ${pkg.name} ${pkg.version}: ${file.name} ----`, '', file.text.replace(/\s+$/, ''));
    }
  }
  return `${lines.join('\n')}\n`;
}

async function licenceFiles(pkg) {
  const dir = dirname(pkg.manifest_path);
  const names = (await readdir(dir)).filter((name) => LICENCE_FILE.test(name)).sort(byteOrder);
  return Promise.all(names.map(async (name) => ({ name, text: await readFile(join(dir, name), 'utf8') })));
}

/**
 * Runs `cargo metadata` in `crateDir` (Cargo.lock as is) and returns the notice for its binary. A few crates
 * publish no licence file; `fallback(pkg)` gives their texts ([{ name, text }]) or undefined.
 */
export async function cargoNotice(
  crateDir,
  { platform = 'aarch64-apple-darwin', fallback = () => undefined } = {},
) {
  const { stdout } = await exec(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--filter-platform', platform],
    { cwd: crateDir, maxBuffer: 256 * 1024 * 1024 },
  );
  const packages = linkedPackages(JSON.parse(stdout));
  const files = new Map();
  for (const pkg of packages) {
    const own = await licenceFiles(pkg);
    files.set(pkg.id, own.length > 0 ? own : (fallback(pkg) ?? []));
  }
  return cratesNotice(packages, (pkg) => files.get(pkg.id));
}
