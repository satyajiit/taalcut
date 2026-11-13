// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which pieces a yt-dlp build bundles and what each one is licensed under, from inventory.py's report (every file
 * PyInstaller collected, every installed distribution with its declared licence and files) and the Python build's
 * PYTHON.json. Pure. Anything the reviewed tables in pins.mjs don't cover is a problem, and a build with problems
 * is not shipped.
 */
import { normaliseName } from './requirements.mjs';

/** The licence a distribution declares: License-Expression, else License, else its classifiers. */
export function declaredLicence(dist) {
  if (dist.licenseExpression) return dist.licenseExpression;
  if (dist.license) return dist.license;
  return dist.classifiers.map((c) => c.replace(/^License :: /, '')).join('; ') || undefined;
}

/** Every licence PYTHON.json names: the interpreter's own and each extension module's, with their text paths. */
export function pythonLicences(pythonJson) {
  const licences = new Set(pythonJson.licenses ?? []);
  const paths = new Set(pythonJson.license_path ? [pythonJson.license_path] : []);
  for (const variants of Object.values(pythonJson.build_info?.extensions ?? {}))
    for (const variant of variants) {
      for (const licence of variant.licenses ?? []) licences.add(licence);
      for (const path of variant.license_paths ?? []) paths.add(path);
    }
  return { licences: [...licences].sort(), paths: [...paths].sort() };
}

function ownerOf(report) {
  const owners = new Map();
  for (const dist of report.distributions) for (const file of dist.files) owners.set(file, dist);
  return (path) => {
    const dist = owners.get(path);
    if (dist) return { kind: 'distribution', dist };
    if (path.startsWith(`${report.base}/`)) return { kind: 'python' };
    if (path.startsWith(`${report.source}/`)) return { kind: 'yt-dlp' };
    return undefined;
  };
}

/**
 * { pieces, problems }. pieces: [{ name, version, spdx, copyleft, declared?, bundles?, licenseFiles }], yt-dlp and
 * Python first, then the distributions in name order. `tables` is { distributions, copyleft } from pins.mjs.
 */
export function inventory(report, pythonJson, { ytDlpVersion, distributions, copyleft }) {
  const problems = [];
  const owner = ownerOf(report);
  const bundled = new Map();
  for (const path of report.collected) {
    const found = owner(path);
    if (!found) problems.push(`collected file from no known distribution: ${path}`);
    else if (found.kind === 'distribution') bundled.set(found.dist.name, found.dist);
  }
  // The bootloader is the executable itself, which no TOC lists as a collected file.
  const installer = report.distributions.find((d) => normaliseName(d.name) === 'pyinstaller');
  if (installer) bundled.set(installer.name, installer);
  else problems.push('PyInstaller is not installed in the build environment');

  const python = pythonLicences(pythonJson);
  for (const licence of python.licences)
    if (copyleft.test(licence)) problems.push(`Python bundles a library under ${licence}`);
  const pieces = [
    { name: 'yt-dlp', version: ytDlpVersion, spdx: 'Unlicense', copyleft: false, licenseFiles: [] },
    {
      name: 'Python',
      version: report.python,
      spdx: python.licences.join(' AND '),
      copyleft: false,
      licenseFiles: python.paths,
      bundles: 'python-build-standalone: the interpreter and the C libraries its extension modules link',
    },
  ];
  const tableByName = new Map(Object.entries(distributions).map(([name, row]) => [normaliseName(name), row]));
  for (const dist of [...bundled.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = tableByName.get(normaliseName(dist.name));
    const declared = declaredLicence(dist);
    if (!row) {
      problems.push(`${dist.name} ${dist.version} (${declared}) is bundled but not reviewed in pins.mjs`);
      continue;
    }
    if (row.declared !== declared)
      problems.push(`${dist.name} ${dist.version} now declares "${declared}", reviewed as "${row.declared}"`);
    pieces.push({
      name: dist.name,
      version: dist.version,
      spdx: row.spdx,
      copyleft: row.copyleft === true,
      declared,
      ...(row.bundles ? { bundles: row.bundles } : {}),
      licenseFiles: dist.licenseFiles,
    });
  }
  return { pieces, problems };
}

/** INVENTORY.txt: one line per piece, copyleft ones marked with where their source is. */
export function inventoryText(pieces, sourceNote) {
  const lines = pieces.map((piece) => {
    const extra = piece.bundles ? `; bundles ${piece.bundles}` : '';
    const mark = piece.copyleft ? ` [copyleft: source hosted, ${sourceNote}]` : '';
    return `${piece.name} ${piece.version}: ${piece.spdx}${extra}${mark}`;
  });
  return `${lines.join('\n')}\n`;
}
