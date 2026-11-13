// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coveredGateRows } from '../../src/gates/catalog';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const GATES_ROOTS = [join(REPO_ROOT, 'tools/evals/src/gates'), join(REPO_ROOT, 'tools/evals/test/gates')];
/** The launch plan's gate tables. A checkout without the planning documents has nothing to compare against. */
const PLAN = join(REPO_ROOT, 'plan/phase-3-launch.md');

function tableRows(section: string): number[] {
  const rows: number[] = [];
  for (const line of section.split('\n')) {
    const match = /^\|\s*(\d+)\s*\|/.exec(line);
    const raw = match?.[1];
    if (raw !== undefined) rows.push(Number(raw));
  }
  return rows;
}

/** Beta and v1 tables under `## Exit gates`, and nothing from later sections. */
function planRows(markdown: string): { beta: number[]; v1: number[] } {
  const exit = markdown.split(/^## /m).find((block) => block.startsWith('Exit gates'));
  if (exit === undefined) throw new Error('plan has no Exit gates section');
  const parts = exit.split(/^### /m);
  const beta = parts.find((block) => block.startsWith('Public beta'));
  const v1 = parts.find((block) => block.startsWith('v1.0'));
  if (beta === undefined || v1 === undefined) throw new Error('plan is missing a gate table');
  return { beta: tableRows(beta), v1: tableRows(v1) };
}

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (name.endsWith('.ts')) found.push(path);
  }
  return found;
}

function lineCount(path: string): number {
  const lines = readFileSync(path, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

describe('exit-gate coverage', () => {
  it.skipIf(!existsSync(PLAN))('gives every beta and v1 row a metric target or a manual row', () => {
    const plan = readFileSync(PLAN, 'utf8');
    const rows = planRows(plan);
    const covered = coveredGateRows();
    expect(rows.beta).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows.v1).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(covered.beta).toEqual(rows.beta);
    expect(covered.v1).toEqual(rows.v1);
  });

  it('keeps every gates file at or under 400 lines, with the SPDX header', () => {
    const files = GATES_ROOTS.flatMap(walk);
    expect(files.length).toBeGreaterThan(10);
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      expect(lineCount(path), relative(REPO_ROOT, path)).toBeLessThanOrEqual(400);
      expect(text.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later\n'), path).toBe(true);
      if (path.includes(`${join('src', 'gates')}/`)) {
        expect(text, path).not.toMatch(/@ts-ignore|@ts-expect-error/);
        expect(text, path).not.toContain('as unknown as');
      }
    }
  });
});
