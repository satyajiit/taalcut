// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Production-licence scan (P1-A3). Exits 1 on a rejection.
 *
 *   node scripts/licence-scan.mjs
 *
 * NOTICE bytes come from scripts/notice.mjs. main() imports that writer
 * dynamically so this module can be imported by the writer without a cycle.
 *
 * The allowlist is explicit. `Apache` means Apache-2.0, `BlueOak` means
 * BlueOak-1.0.0, and `CC0` means CC0-1.0. `BSD` is not an alias. An OR
 * passes when one side is allowed; an AND passes only when every side is.
 * GPL and LGPL fail even where GNU would treat them as combinable with AGPL.
 * Commons Clause fails except for package names matching /react-bits/i.
 * One package passes by name with a licence outside the allowlist: `gsap`,
 * under GreenSock's Standard "no charge" licence (GSAP_EXCEPTION below).
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const ALLOWED_LICENCES = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  // The bundled, unmodified npm CLI. FSF lists Artistic 2.0 as GPL-compatible via §4(c)(ii).
  // https://www.gnu.org/licenses/license-list.en.html#ArtisticLicense2
  'Artistic-2.0',
  'MPL-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  // AGT2 sbx, owner decision 2026-11-03: the workspace shell's toolchain. CPython ships with the app (PSF-2.0),
  // and Node 24 carries ICU (Unicode-3.0) and zlib (Zlib). All three are GPLv3-compatible permissive licences.
  'PSF-2.0',
  'Unicode-3.0',
  'Zlib',
  'AGPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0',
  // The bundled UI fonts (Onest, JetBrains Mono and the Noto families).
  // GNU lists OFL as a free font licence that may ship with GPL-family software.
  'OFL-1.1',
  // Data packages such as caniuse-lite; GNU lists CC BY 4.0 as GPLv3-compatible.
  // Attribution is carried by NOTICE.
  'CC-BY-4.0',
];

const ALLOWED = new Set(ALLOWED_LICENCES);

const ALIASES = new Map([
  ['Apache', 'Apache-2.0'],
  ['BlueOak', 'BlueOak-1.0.0'],
  ['CC0', 'CC0-1.0'],
]);

const REACT_BITS_NOTE =
  'React Bits (MIT + Commons Clause) is used inside the app and is not redistributed as a standalone kit.';

/**
 * PO decision 2026-10-25: GSAP used directly as a design tool. The `gsap` package, unmodified with its notices,
 * is the motion engine of the graphics Taalcut renders (render SPEC "GSAP motion"). Only this package name with
 * exactly this licence string passes; a different licence string from a later GSAP fails until it is reviewed.
 */
export const GSAP_EXCEPTION = {
  name: 'gsap',
  license: "Standard 'no charge' license: https://gsap.com/standard-license.",
  note: 'GSAP ships unmodified under its Standard "no charge" licence (https://gsap.com/standard-license) as the engine of the motion graphics Taalcut renders: PO decision 2026-10-25, GSAP used directly as a design tool.',
};

/**
 * Packages Taalcut ships modified (pnpm-workspace.yaml `patchedDependencies`), with what changed: the Apache-2.0
 * modified-file notice (section 4(b)). Keyed by `name@version`, so a new version needs its patch and line again.
 */
export const MODIFIED_PACKAGES = {
  '@hyperframes/engine@0.8.209':
    'Modified by Taalcut (patches/@hyperframes__engine@0.8.209.patch): dist/utils/managedChildProcess.js, dist/utils/gpuEncoder.js, dist/utils/processTracker.js and .d.ts, and dist/services/browserManager.js never SIGKILL FFmpeg or the browser; one SIGTERM, then a stall report. dist/utils/gpuEncoder.js and .d.ts and dist/index.js and .d.ts export gpuProbesExited, so a GPU encoder probe past its deadline stays counted until it exits. dist/utils/gpuEncoder.js gives the trial encode of a GPU encoder 30 s, not 2 s, before it counts that encoder as unusable: a deadline for a hung session, not a busy machine; and it takes the GPU encoder family the host names (HYPERFRAMES_GPU_ENCODER) without detecting one. dist/utils/processTracker.js and .d.ts, dist/services/browserManager.js, dist/services/hdrCapture.js and dist/index.js and .d.ts tell a listener (onChildProcess) the pid of every FFmpeg, ffprobe and Chrome process as it starts (Chrome at its spawn, through @puppeteer/browsers onBrowserSpawn, before its launch waits for DevTools), so the caller records it in its hardware session slot. dist/services/browserManager.js and .d.ts and dist/index.js and .d.ts keep the Chrome sandbox on when the host asks (HYPERFRAMES_CHROME_SANDBOX, chromeSandboxArgs), keep the WebGL vendor and renderer the GPU probe saw, for the host to log (browserGpuProbe), and on Linux run hardware mode on ANGLE over Vulkan instead of EGL. dist/services/drawElementService.js and dist/services/frameCapture.js capture a drawElement frame only from its own canvas paint event: upstream drew the last recorded snapshot after 250 ms without one; patched, the capture waits, and a paint that has not come in 10 s fails the drawElement attempt recoverably (HF_DE_PAINT_TIMEOUT), which the producer re-renders by screenshot. dist/services/drawElementService.js feature-detects Chrome 155+ canvas content=drawable and marks only the composition root drawable; modern draws preserve source element geometry, while the legacy layoutsubtree path is retained.',
  '@puppeteer/browsers@3.2.4':
    'Modified by Taalcut (patches/@puppeteer__browsers@3.2.4.patch): lib/launch.js stops the browser with one SIGTERM instead of SIGKILL on macOS and Linux, then a stall report, and sends none when the host has already sent it (ChildProcess.killed). lib/launch.js and .d.ts and lib/main.js and .d.ts export onBrowserSpawn, which tells a listener of each browser process on the turn it is spawned.',
};

const NO_HOMEPAGE = '(no homepage)';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });

export function shouldSkipPackage(packageName) {
  return typeof packageName === 'string' && packageName.startsWith('@taalcut/');
}

function stripOneWrappingParens(expr) {
  const trimmed = expr.trim();
  if (trimmed.length < 2 || trimmed[0] !== '(' || trimmed.at(-1) !== ')') return trimmed;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0 && i !== trimmed.length - 1) return trimmed;
      if (depth < 0) return trimmed;
    }
  }
  if (depth !== 0) return trimmed;
  return trimmed.slice(1, -1).trim();
}

function splitTopLevel(expr, operator) {
  const needle = ` ${operator} `;
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0 && expr.startsWith(needle, i)) {
      parts.push(expr.slice(start, i).trim());
      start = i + needle.length;
      i = start - 1;
    }
  }
  if (parts.length === 0) return null;
  parts.push(expr.slice(start).trim());
  return parts;
}

function tokenAllowed(token) {
  const normalised = ALIASES.get(token) ?? token;
  return ALLOWED.has(normalised);
}

function expressionAllowed(expr) {
  const stripped = stripOneWrappingParens(expr);
  const orParts = splitTopLevel(stripped, 'OR');
  if (orParts) {
    return orParts.every((part) => part.length > 0) && orParts.some((part) => expressionAllowed(part));
  }
  const andParts = splitTopLevel(stripped, 'AND');
  if (andParts) return andParts.every((part) => part.length > 0 && expressionAllowed(part));
  return tokenAllowed(stripped);
}

/**
 * @param {string | null | undefined} license
 * @param {string | null | undefined} packageName
 * @returns {{ ok: boolean, note?: string }}
 */
export function classify(license, packageName) {
  const name = typeof packageName === 'string' ? packageName : '';
  const raw = typeof license === 'string' ? license.trim() : '';
  const reactBits = /react-bits/i.test(name);
  const commons = /commons clause/i.test(raw);

  if (reactBits && (commons || raw === 'MIT')) return { ok: true, note: REACT_BITS_NOTE };
  if (name === GSAP_EXCEPTION.name && raw === GSAP_EXCEPTION.license)
    return { ok: true, note: GSAP_EXCEPTION.note };
  if (commons || raw === '') return { ok: false };
  if (!expressionAllowed(raw)) return { ok: false };
  return { ok: true };
}

function licenceOf(pkg, group) {
  if (typeof pkg.license === 'string' && pkg.license.trim() !== '') return pkg.license.trim();
  return typeof group === 'string' ? group.trim() : '';
}

function versionsOf(pkg) {
  if (Array.isArray(pkg.versions) && pkg.versions.length > 0)
    return pkg.versions.map((version) => String(version));
  if (typeof pkg.versions === 'string' && pkg.versions !== '') return [pkg.versions];
  if (typeof pkg.version === 'string' && pkg.version !== '') return [pkg.version];
  return ['(unknown)'];
}

function homepageOf(pkg) {
  if (typeof pkg.homepage === 'string' && pkg.homepage.trim() !== '') return pkg.homepage.trim();
  return NO_HOMEPAGE;
}

function compareRows(left, right) {
  return (
    collator.compare(left.name, right.name) ||
    collator.compare(left.version, right.version) ||
    collator.compare(left.license, right.license)
  );
}

function rowNote(decision, pkg) {
  const parts = [];
  if (typeof decision.note === 'string' && decision.note !== '') parts.push(decision.note);
  if (typeof pkg.resolvedNote === 'string' && pkg.resolvedNote !== '') parts.push(pkg.resolvedNote);
  return parts.join(' ');
}

export function rowsFromReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('Expected an object keyed by licence, as printed by pnpm licenses list --json');
  }
  const rows = [];
  const failures = [];
  const seen = new Set();
  for (const [group, packages] of Object.entries(report)) {
    if (!Array.isArray(packages)) continue;
    for (const pkg of packages) {
      if (pkg === null || typeof pkg !== 'object') continue;
      const license = licenceOf(pkg, group);
      if (typeof pkg.name !== 'string' || pkg.name === '') {
        failures.push({
          name: '(unnamed)',
          version: '(unknown)',
          license,
          homepage: NO_HOMEPAGE,
          ok: false,
          note: '',
        });
        continue;
      }
      if (shouldSkipPackage(pkg.name)) continue;
      const decision = classify(license, pkg.name);
      for (const version of versionsOf(pkg)) {
        const key = `${pkg.name}\0${version}\0${license}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = {
          name: pkg.name,
          version,
          license,
          homepage: homepageOf(pkg),
          ok: decision.ok,
          note: [rowNote(decision, pkg), MODIFIED_PACKAGES[`${pkg.name}@${version}`] ?? '']
            .filter((part) => part !== '')
            .join(' '),
        };
        rows.push(row);
        if (!decision.ok) failures.push(row);
      }
    }
  }
  rows.sort(compareRows);
  failures.sort(compareRows);
  return { rows, failures };
}

export function printFailures(failures) {
  console.error(`Licence scan failed. ${failures.length} package(s) are not on the allowlist:`);
  console.error(ALLOWED_LICENCES.join(', '));
  console.error('');
  console.error(
    'An OR expression is allowed when at least one side is allowed. An AND expression is allowed only when every side is allowed.',
  );
  console.error(
    'One layer of wrapping parentheses is stripped. Aliases: Apache -> Apache-2.0, BlueOak -> BlueOak-1.0.0, CC0 -> CC0-1.0.',
  );
  console.error(
    'BSD is not an alias. Commons Clause is rejected except for package names matching /react-bits/i. gsap passes by name with its Standard "no charge" licence.',
  );
  console.error('');
  for (const row of failures) console.error(`  ${row.name}  ${row.version}  ${row.license}  ${row.homepage}`);
}

export function readProdLicences() {
  const stdout = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const preview = stdout.slice(0, 180).replaceAll('\n', ' ');
    throw new Error(`pnpm licences JSON could not be parsed (${reason}). Starts with: ${preview}`, {
      cause: error,
    });
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

async function main() {
  let report;
  try {
    report = readProdLicences();
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : '';
    console.error('pnpm licenses list --json --prod failed.');
    console.error(stderr || (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
  // Dynamic import: notice/run.mjs imports this file, so a top-level import cycles.
  const { runNotice } = await import('./notice/run.mjs');
  let result;
  try {
    result = runNotice({ report, root: ROOT, noticePath: join(ROOT, 'NOTICE'), check: false });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (result.code !== 0) process.exit(result.code);
  for (const row of result.rows) if (row.note) console.log(`note: ${row.name}@${row.version}: ${row.note}`);
  console.log(
    `Licence scan passed (${result.rows.length} packages). Wrote NOTICE, the same bytes as \`pnpm notice\`.`,
  );
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
