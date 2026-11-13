// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { printFailures, rowsFromReport } from '../licence-scan.mjs';
import { loadComponents } from './components.mjs';
import { differingSections } from './format.mjs';
import { carriedRows, currentHost, withCarriedRows } from './other-platforms.mjs';
import { renderDocument } from './render.mjs';
import { fillMissingLicences } from './resolve-unknown.mjs';
import { loadVendored } from './vendored.mjs';

function readExisting(noticePath) {
  try {
    return readFileSync(noticePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

function readLockfile(root) {
  try {
    return readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Build NOTICE from an already-loaded production report. Does not call pnpm.
 * Rows for packages this machine can't install (another OS's binaries) come from the NOTICE already there, while
 * the lockfile has them (other-platforms.mjs), so a Mac and Linux write the same file.
 * A rejected licence exits through `code` and does not write, including on --check.
 * `--check` compares sections and leaves the file untouched.
 */
export function runNotice(options) {
  const root = options.root;
  const noticePath = options.noticePath ?? join(root, 'NOTICE');
  const thirdPartyDir = options.thirdPartyDir ?? join(root, 'third_party');
  const componentsDir = options.componentsDir ?? join(root, 'tools', 'components');
  const listed = rowsFromReport(fillMissingLicences(options.report, root));
  const previous = readExisting(noticePath);
  const carried = carriedRows(
    previous,
    options.lockfile ?? readLockfile(root),
    options.host ?? currentHost(),
  );
  const rows = withCarriedRows(listed.rows, carried);
  const failures = listed.failures;
  const vendored = loadVendored(thirdPartyDir, root);
  const components = loadComponents(componentsDir);
  const text = renderDocument({ rows, vendored, components });
  if (options.check) {
    if (previous !== text) {
      const differed = differingSections(
        previous,
        text,
        vendored.map((block) => block.heading),
      );
      console.error(`NOTICE is stale. Sections that differ: ${differed.join(', ')}.`);
      return { code: 1, rows, failures, differed, text };
    }
    // A listed rejection is already in the file. Staleness is the failure here.
    // `pnpm licence:scan` still exits 1 while any rejection remains.
    return { code: 0, rows, failures, differed: [], text };
  }
  if (failures.length > 0) printFailures(failures);
  writeFileSync(noticePath, text);
  return { code: failures.length > 0 ? 1 : 0, rows, failures, differed: [], text };
}
