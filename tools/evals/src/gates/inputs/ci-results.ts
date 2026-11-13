// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { readJson } from '../../files';
import { parseJsonLines } from '../../jsonl';
import { perfRowSchema, type PerfRow } from '../../perf/schema';
import { readNdjsonBytes, sourceOf } from './digest';
import { parseWith } from './parse';
import { type CiInput, type CiResult, type PerfInput, type SourceRef } from './types';

const metricSchema = z.strictObject({
  name: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
});

const ciSchema = z.strictObject({
  id: z.string().min(1),
  pass: z.boolean(),
  synthetic: z.boolean(),
  detail: z.string(),
  metrics: z.array(metricSchema).optional(),
});

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${dir}: ${message}`, { cause: error });
  }
}

function loadResults(dir: string, names: readonly string[]): { results: CiResult[]; sources: SourceRef[] } {
  const results: CiResult[] = [];
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const path = join(dir, name);
    const parsed = parseWith(ciSchema, readJson(path), path);
    const id = basename(name, '.json');
    if (parsed.id !== id) throw new Error(`${path} id is ${parsed.id}, expected ${id}`);
    if (seen.has(parsed.id)) throw new Error(`${dir} has two results named ${parsed.id}`);
    seen.add(parsed.id);
    const source = sourceOf(path, parsed.synthetic);
    sources.push(source);
    results.push({
      id: parsed.id,
      pass: parsed.pass,
      synthetic: parsed.synthetic,
      detail: parsed.detail,
      metrics: parsed.metrics ?? [],
      source,
    });
  }
  return { results, sources };
}

function loadPerf(dir: string, names: readonly string[]): { rows: PerfRow[]; sources: SourceRef[] } | null {
  const files = names.filter((entry) => entry.endsWith('.jsonl')).sort();
  if (files.length === 0) return null;
  const rows: PerfRow[] = [];
  const sources: SourceRef[] = [];
  for (const name of files) {
    const path = join(dir, name);
    const read = readNdjsonBytes(path);
    const fileRows = parseJsonLines(read.text, path, (value) =>
      parseWith(perfRowSchema, value, 'the perf row'),
    );
    rows.push(...fileRows);
    sources.push({ ...read.source, synthetic: fileRows.some((row) => row.synthetic) });
  }
  return { rows, sources };
}

export interface CiDir {
  ci: CiInput;
  perf: PerfInput | { kind: 'absent' };
}

/** JSON results plus perf JSONL. No JSONL means perf is absent, so a `performance` CI file can stand in. */
export function loadCiDir(dir: string): CiDir {
  const names = readDir(dir);
  const loaded = loadResults(dir, names);
  const perf = loadPerf(dir, names);
  return {
    ci: { kind: 'present', results: loaded.results, sources: loaded.sources },
    perf:
      perf === null
        ? { kind: 'absent' }
        : {
            kind: 'present',
            rows: perf.rows,
            sources: perf.sources,
            synthetic: perf.sources.some((source) => source.synthetic),
          },
  };
}
