// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vendored code must be live (P3-B1). A `file:` dependency is a copy pnpm takes at install time into
 * node_modules/.pnpm: a checkout that installed before a change under third_party/ and then pulled or merged it
 * keeps running the old copy, with identical sources on disk (15 Kaatu tests failed that way after main's
 * 845921d3). So every third_party package is a workspace package, depended on with `workspace:*`, and nothing in
 * the workspace or the lockfile is a `file:` copy.
 */

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** The `packages:` globs of pnpm-workspace.yaml (`- dir/*` or `- dir`, quotes optional). */
export function workspaceGlobs(yaml) {
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inPackages = /^packages:\s*$/.test(line);
    else if (inPackages) {
      const item = /^\s+-\s+['"]?([^'"#\s]+)['"]?/.exec(line);
      if (item?.[1]) globs.push(item[1]);
    }
  }
  return globs;
}

/** Whether a workspace glob (`dir`, `dir/*`) covers the repository-relative directory `dir`. */
export function globCovers(glob, dir) {
  if (glob.endsWith('/*')) {
    const parent = glob.slice(0, -2);
    return dir.startsWith(`${parent}/`) && !dir.slice(parent.length + 1).includes('/');
  }
  return glob === dir;
}

/**
 * Every rule broken, as one line each.
 * @param {{
 *   globs: string[],
 *   manifests: { path: string, json: Record<string, unknown> }[],
 *   vendored: { dir: string, name: string }[],
 *   lockfile: string,
 *   installed?: { path: string, target: string }[],
 * }} repo `manifests` are every workspace package.json (root included); `vendored` the third_party packages;
 *   `installed` each `node_modules/<vendored name>` that exists in the checkout, with the directory it really is.
 * @returns {string[]}
 */
export function vendoredViolations({ globs, manifests, vendored, lockfile, installed = [] }) {
  const problems = [];
  const vendoredNames = new Set(vendored.map((entry) => entry.name));
  for (const { dir, name } of vendored) {
    if (!globs.some((glob) => globCovers(glob, dir))) {
      problems.push(`${dir} (${name}) is not a workspace package: add it to pnpm-workspace.yaml's packages`);
    }
  }
  for (const { path, json } of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      const deps = json[field];
      if (typeof deps !== 'object' || deps === null) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec !== 'string') continue;
        if (spec.startsWith('file:')) {
          problems.push(
            `${path} ${field}.${name} is "${spec}": a file: dependency is a copy taken at install`,
          );
        } else if (vendoredNames.has(name) && !spec.startsWith('workspace:')) {
          problems.push(`${path} ${field}.${name} is "${spec}": depend on vendored code with "workspace:*"`);
        }
      }
    }
  }
  for (const [index, line] of lockfile.split('\n').entries()) {
    if (/(?:specifier|version):\s+file:|@file:|type: directory\b/.test(line)) {
      problems.push(`pnpm-lock.yaml:${index + 1} resolves a file: copy (${line.trim()})`);
    }
  }
  const vendoredDirs = new Set(vendored.map((entry) => entry.dir));
  for (const { path, target } of installed) {
    if (!vendoredDirs.has(target)) {
      problems.push(`${path} is ${target}, not the vendored source: a stale install, run pnpm install`);
    }
  }
  return problems;
}
