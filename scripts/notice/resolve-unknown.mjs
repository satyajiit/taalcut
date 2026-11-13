// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENCE', 'license', 'COPYING'];
const README_FILES = ['Readme.md', 'README.md', 'README'];

/**
 * pnpm reports "Unknown" when package.json has no license field.
 * Fill that only from an unambiguous file in the installed package:
 * an Apache-2.0 or MIT licence text, or a Readme heading whose body is one SPDX token.
 * A stated non-allowlist identifier, such as FSL, is left alone.
 */
export function fillMissingLicences(report, root) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return report;
  for (const packages of Object.values(report)) {
    if (!Array.isArray(packages)) continue;
    for (const pkg of packages) {
      if (pkg === null || typeof pkg !== 'object') continue;
      if (!needsFill(pkg)) continue;
      const version = firstVersion(pkg);
      if (typeof pkg.name !== 'string' || version === '') continue;
      const dir = packageDir(root, pkg.name, version);
      if (dir === '') continue;
      const found = readDeclaredLicence(dir);
      if (!found) continue;
      pkg.license = found.spdx;
      pkg.resolvedNote = found.note;
    }
  }
  return report;
}

function needsFill(pkg) {
  const raw = typeof pkg.license === 'string' ? pkg.license.trim() : '';
  return raw === '' || raw.toLowerCase() === 'unknown';
}

function firstVersion(pkg) {
  if (Array.isArray(pkg.versions) && pkg.versions.length > 0) return String(pkg.versions[0]);
  if (typeof pkg.version === 'string') return pkg.version;
  return '';
}

function packageDir(root, name, version) {
  const store = join(root, 'node_modules', '.pnpm');
  if (!existsSync(store)) return '';
  const slug = name.replace('/', '+');
  const prefix = `${slug}@${version}`;
  let match = '';
  for (const entry of readdirSync(store)) {
    if (entry !== prefix && !entry.startsWith(`${prefix}_`)) continue;
    const dir = join(store, entry, 'node_modules', ...name.split('/'));
    if (!existsSync(join(dir, 'package.json'))) continue;
    if (entry === prefix) return dir;
    if (match === '') match = dir;
  }
  return match;
}

function readDeclaredLicence(dir) {
  for (const name of LICENCE_FILES) {
    const text = readIfFile(join(dir, name));
    if (text === '') continue;
    const spdx = spdxFromLicenceText(text);
    if (spdx) return { spdx, note: `package.json has no license field; ${name} is the ${spdx} text.` };
  }
  for (const name of README_FILES) {
    const text = readIfFile(join(dir, name));
    if (text === '') continue;
    const spdx = spdxFromReadme(text);
    if (spdx) return { spdx, note: `package.json has no license field; ${name} says ${spdx}.` };
  }
  return null;
}

function readIfFile(path) {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function spdxFromLicenceText(text) {
  const head = text.slice(0, 800);
  if (/Apache License/i.test(head) && /Version 2\.0/.test(head)) return 'Apache-2.0';
  if (/MIT License/i.test(head) || /Permission is hereby granted, free of charge/i.test(head)) return 'MIT';
  return null;
}

function spdxFromReadme(text) {
  const match = text.match(/^#{1,3} Licen[cs]e\s*\n+([A-Za-z0-9.+-]+)\s*$/m);
  if (!match) return null;
  const token = match[1];
  if (
    token === 'MIT' ||
    token === 'Apache-2.0' ||
    token === 'ISC' ||
    token === 'BSD-3-Clause' ||
    token === 'BSD-2-Clause'
  )
    return token;
  return null;
}
