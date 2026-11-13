// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkExtractDrift, runLinguiExtract } from './extract-drift.ts';
import { type Finding, formatFinding } from './finding.ts';
import { checkFreeze, writeManifest } from './freeze.ts';
import { writeHandoff } from './handoff.ts';
import { checkIcu } from './icu.ts';
import { importCatalogue } from './import.ts';
import { checkMissing } from './missing.ts';
import { CATALOGUE_SETS, displayPath, localesDir, repoRoot, statusPath } from './paths.ts';
import { checkPlaceholders } from './placeholders.ts';
import { checkReview } from './review.ts';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: node scripts/i18n.mjs <command>

Commands:
  check                         Extract drift, ICU, missing translations, string freeze
  handoff <locale> --out <dir>  Write <locale>.po and README.md for translators
  import --locale <locale> --from <dir>
                                Merge a returned catalogue into the renderer catalogues
  unfreeze                      Rewrite frozen-ids.json from the English catalogue

UI strings for the renderer and packages/ui live in apps/renderer/src/locales.
packages/ui has no catalogue of its own; its i18n:check script runs this same check.
`;

interface Parsed {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string>;
}

export function parseArgs(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (name === '') throw new Error('missing flag name');
    if (eq !== -1) {
      flags.set(name, arg.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`missing value for --${name}`);
    flags.set(name, next);
    i += 1;
  }
  return { command, positionals, flags };
}

function flag(flags: Map<string, string>, name: string): string | undefined {
  return flags.get(name);
}

/** One line per catalogue. A draft locale has a missing line for every message; listing them buries errors. */
export function summariseWarnings(warnings: Finding[]): string[] {
  const counts = new Map<string, number>();
  for (const warning of warnings) counts.set(warning.file, (counts.get(warning.file) ?? 0) + 1);
  return [...counts].map(
    ([file, count]) => `${file}: ${count} missing translation(s), allowed until signed-off`,
  );
}

function extractErrors(root: string): string[] {
  const drift = checkExtractDrift(localesDir(root), () => runLinguiExtract(root));
  if (drift.ok) return [];
  const errors = drift.files.map((file) => `extract drift: ${displayPath(root, file)}`);
  if (drift.detail) errors.push(drift.detail);
  if (errors.length === 0) errors.push('lingui extract failed');
  return errors;
}

/** Missing translations and review flags against status.json; warnings and notes go to stderr as they're found. */
function statusErrors(root: string, io: Io): { errors: string[]; warnings: number } {
  let statusText: string;
  try {
    statusText = readFileSync(statusPath(root), 'utf8');
  } catch {
    return { errors: [`${displayPath(root, statusPath(root))}:1: status.json is missing`], warnings: 0 };
  }
  const missing = checkMissing(root, statusText);
  for (const line of summariseWarnings(missing.warnings)) io.stderr(`warning: ${line}\n`);
  const errors = missing.errors.map(formatFinding);
  for (const set of CATALOGUE_SETS) {
    const review = checkReview(root, statusText, localesDir(root, set));
    for (const line of review.summaries) io.stderr(`note: ${line}, until a native speaker signs it off\n`);
    errors.push(...review.errors.map(formatFinding));
  }
  return { errors, warnings: missing.warnings.length };
}

export function runCheck(root: string, io: Io): number {
  const errors = extractErrors(root);
  // The renderer's catalogues and main's (its own extract and compile run in @taalcut/desktop's i18n:extract).
  for (const set of CATALOGUE_SETS) {
    const dir = localesDir(root, set);
    errors.push(
      ...checkIcu(root, dir).map(formatFinding),
      ...checkPlaceholders(root, dir).map(formatFinding),
    );
  }
  const status = statusErrors(root, io);
  errors.push(...status.errors, ...checkFreeze(root).map(formatFinding));
  if (errors.length > 0) {
    for (const error of errors) io.stderr(`${error}\n`);
    return 1;
  }
  io.stdout(`i18n check: ok, ${status.warnings} missing-translation warning(s)\n`);
  return 0;
}

function runHandoff(root: string, parsed: Parsed, io: Io): number {
  const locale = parsed.positionals[0];
  const out = flag(parsed.flags, 'out');
  if (!locale || parsed.positionals.length !== 1) {
    io.stderr('handoff needs one locale. Example: node scripts/i18n.mjs handoff hi --out <dir>\n');
    return 1;
  }
  if (!out) {
    io.stderr('handoff requires --out <dir>\n');
    return 1;
  }
  const wrote = writeHandoff(root, locale, resolve(out));
  if (!wrote.ok) {
    io.stderr(`${wrote.message}\n`);
    return 1;
  }
  io.stdout(`wrote the ${locale} hand-off (catalogues, README, glossary) to ${out}\n`);
  return 0;
}

function runImport(root: string, parsed: Parsed, io: Io): number {
  const locale = flag(parsed.flags, 'locale');
  const from = flag(parsed.flags, 'from');
  if (!locale || !from || parsed.positionals.length > 0) {
    io.stderr('import needs --locale <locale> --from <dir>\n');
    return 1;
  }
  const result = importCatalogue(root, locale, resolve(from));
  for (const finding of result.errors) io.stderr(`${formatFinding(finding)}\n`);
  if (result.exitCode === 0) io.stdout(`imported ${locale}\n`);
  return result.exitCode;
}

function runUnfreeze(root: string, io: Io): number {
  const wrote = writeManifest(root);
  if (!wrote.ok) {
    io.stderr(`${wrote.message}\n`);
    return 1;
  }
  io.stdout(`wrote frozen-ids.json (${wrote.count} messages)\n`);
  return 0;
}

export function main(argv: string[], io: Io, root: string): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : 'bad arguments'}\n${USAGE}`);
    return 1;
  }
  if (!parsed.command || parsed.command === '--help' || parsed.command === '-h') {
    io.stdout(USAGE);
    return parsed.command ? 0 : 1;
  }
  if (parsed.command === 'check') {
    if (parsed.positionals.length > 0 || parsed.flags.size > 0) {
      io.stderr(`check takes no arguments\n${USAGE}`);
      return 1;
    }
    return runCheck(root, io);
  }
  if (parsed.command === 'handoff') return runHandoff(root, parsed, io);
  if (parsed.command === 'import') return runImport(root, parsed, io);
  if (parsed.command === 'unfreeze') {
    if (parsed.positionals.length > 0 || parsed.flags.size > 0) {
      io.stderr('unfreeze takes no arguments\n');
      return 1;
    }
    return runUnfreeze(root, io);
  }
  io.stderr(`unknown command: ${parsed.command}\n${USAGE}`);
  return 1;
}

export function run(argv: string[]): number {
  return main(
    argv,
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    repoRoot(),
  );
}
