// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fails when vendored code (third_party/*) would be copied at install instead of linked (P3-B1): see
 * scripts/vendored/rules.mjs for why.
 *
 *   node scripts/check-vendored.mjs
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globCovers, vendoredViolations, workspaceGlobs } from './vendored/rules.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const subdirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name))
    : [];

const globs = workspaceGlobs(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'));
const candidates = [
  ...new Set(
    globs.flatMap((glob) =>
      glob.endsWith('/*') ? subdirs(join(ROOT, glob.slice(0, -2))) : [join(ROOT, glob)],
    ),
  ),
];
const manifests = [ROOT, ...candidates]
  .map((dir) => join(dir, 'package.json'))
  .filter((path) => existsSync(path))
  .map((path) => ({ path: relative(ROOT, path), json: readJson(path) }));
const vendored = subdirs(join(ROOT, 'third_party'))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir: relative(ROOT, dir), name: String(readJson(join(dir, 'package.json')).name) }));
// What this checkout really runs: each installed vendored package must be the third_party folder itself.
const realRoot = realpathSync(ROOT);
const vendoredNames = new Set(vendored.map(({ name }) => name));
const installed = manifests.flatMap(({ path, json }) =>
  ['dependencies', 'devDependencies', 'optionalDependencies']
    .flatMap((field) => Object.keys(json[field] ?? {}))
    .filter((name) => vendoredNames.has(name))
    .map((name) => join(ROOT, path, '..', 'node_modules', name))
    .filter((link) => existsSync(link))
    .map((link) => ({ path: relative(ROOT, link), target: relative(realRoot, realpathSync(link)) })),
);
const problems = vendoredViolations({
  globs,
  manifests,
  vendored,
  lockfile: readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'),
  installed,
});

if (problems.length > 0) {
  console.error(`Vendored code must be linked, not copied (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const linked = vendored.filter(({ dir }) => globs.some((glob) => globCovers(glob, dir)));
console.log(`Vendored packages linked as workspace packages: ${linked.map(({ name }) => name).join(', ')}.`);
