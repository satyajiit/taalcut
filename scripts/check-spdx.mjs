// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fails when a source file has no AGPL SPDX header (P1-A4).
 *
 *   node scripts/check-spdx.mjs          check every tracked and new file
 *   node scripts/check-spdx.mjs --fix    add the header where it is missing
 *   node scripts/check-spdx.mjs a.ts b.ts  check only these files
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { addHeader, hasHeader, SPDX, styleFor } from './spdx/headers.mjs';

export { hasHeader, SPDX };

/** Paths that are not ours, are generated elsewhere, or break the rule on purpose. */
const SKIP = [
  /^third_party\//,
  // Logo kit: being edited by the design track; headers added when it settles.
  /^design\/logo\//,
  /^fixtures\/lint-violations\//,
  /(^|\/)node_modules\//,
  /^\.spikes\//,
  /^\.claude\//,
  /^pnpm-lock\.yaml$/,
  /^tools\/ffmpeg\/LICENSES\//,
  /(^|\/)locales\/[^/]+\/messages\.(js|mjs|ts)$/,
];

function listFiles(args) {
  if (args.length > 0) return args;
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  return out.split('\0').filter(Boolean);
}

const argv = process.argv.slice(2);
const fix = argv.includes('--fix');
const files = listFiles(argv.filter((a) => a !== '--fix'));
const missing = [];

for (const file of files) {
  if (SKIP.some((re) => re.test(file)) || !existsSync(file)) continue;
  const style = styleFor(file);
  if (!style) continue;
  const text = readFileSync(file, 'utf8');
  if (hasHeader(text)) continue;
  if (fix) writeFileSync(file, addHeader(text, style));
  else missing.push(file);
}

if (missing.length > 0) {
  console.error(`\nThese files have no licence header (${SPDX}):\n`);
  for (const file of missing) console.error(`  ${file}`);
  console.error('\nRun `pnpm fix:spdx` to add it, or see CONTRIBUTING.md.\n');
  process.exit(1);
}
if (!fix) console.log(`SPDX headers: ${files.length} files checked, all present.`);
