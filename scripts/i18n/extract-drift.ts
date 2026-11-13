// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface ExtractResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface DriftResult {
  ok: boolean;
  files: string[];
  detail: string;
}

function walkMessages(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkMessages(abs, out);
    else if (name === 'messages.po') out.push(abs);
  }
}

function snapshot(localesDir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const found: string[] = [];
  walkMessages(localesDir, found);
  for (const file of found) files.set(file, readFileSync(file));
  return files;
}

function differing(before: Map<string, Buffer>, after: Map<string, Buffer>): string[] {
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const file of [...keys].sort()) {
    const left = before.get(file);
    const right = after.get(file);
    if (!left || !right || !left.equals(right)) changed.push(file);
  }
  return changed;
}

function restore(before: Map<string, Buffer>, after: Map<string, Buffer>): void {
  for (const [file, bytes] of before) {
    const current = after.get(file);
    if (current && current.equals(bytes)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  for (const file of after.keys()) {
    if (before.has(file)) continue;
    if (existsSync(file)) unlinkSync(file);
    const dir = dirname(file);
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  }
}

export function runLinguiExtract(root: string): ExtractResult {
  const result = spawnSync('pnpm', ['--filter', '@taalcut/renderer', 'i18n:extract'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) {
    return { status: 1, stdout: result.stdout ?? '', stderr: result.error.message };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Snapshots catalogue bytes, runs extract, and puts the tree back if anything changed.
 * A failed check must not leave messages.po dirty.
 */
export function checkExtractDrift(localesDir: string, runExtract: () => ExtractResult): DriftResult {
  const before = snapshot(localesDir);
  let result: ExtractResult;
  try {
    result = runExtract();
  } catch (error) {
    result = {
      status: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : 'lingui extract failed',
    };
  }
  const after = snapshot(localesDir);
  const changed = differing(before, after);
  if (changed.length > 0) restore(before, after);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 4000);
    return { ok: false, files: changed, detail: `lingui extract failed (${result.status}): ${detail}` };
  }
  if (changed.length > 0) return { ok: false, files: changed, detail: '' };
  return { ok: true, files: [], detail: '' };
}
