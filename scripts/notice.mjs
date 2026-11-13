// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Write NOTICE, or check it without writing.
 *
 *   node scripts/notice.mjs
 *   node scripts/notice.mjs --check
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProdLicences } from './licence-scan.mjs';
import { runNotice } from './notice/run.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function failProdLicences(error) {
  const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : '';
  console.error('pnpm licenses list --json --prod failed.');
  console.error(stderr || (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) {
    console.error('Usage: node scripts/notice.mjs [--check]');
    process.exit(1);
  }
  const check = args.includes('--check');
  let report;
  try {
    report = readProdLicences();
  } catch (error) {
    failProdLicences(error);
  }
  let result;
  try {
    result = runNotice({ report, root: ROOT, check });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (result.code !== 0) process.exit(result.code);
  if (check) {
    console.log('NOTICE is up to date.');
    return;
  }
  for (const row of result.rows) if (row.note) console.log(`note: ${row.name}@${row.version}: ${row.note}`);
  console.log(`Wrote NOTICE (${result.rows.length} packages).`);
}

main();
