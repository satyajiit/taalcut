// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * JSON lines: one object per line, no pretty print. Perf rows, soak results, telemetry exports and CI perf files all
 * use this format, so they share one reader and one writer.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Parse every non-empty line with `parse`. A bad line throws and names the file and its 1-based line number. */
export function parseJsonLines<T>(text: string, path: string, parse: (value: unknown) => T): T[] {
  const rows: T[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').replace(/\r$/, '');
    if (line.trim() === '') continue;
    try {
      rows.push(parse(JSON.parse(line) as unknown));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${path} line ${index + 1}: ${message}`, { cause: error });
    }
  }
  return rows;
}

export function readJsonLines<T>(path: string, parse: (value: unknown) => T): T[] {
  return parseJsonLines(readFileSync(path, 'utf8'), path, parse);
}

/** Append rows, one per line. Creates parent directories and starts on a new line if the file lacks a final one. */
export function appendJsonLines(path: string, rows: readonly unknown[]): void {
  if (rows.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const payload = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  if (!existsSync(path)) {
    writeFileSync(path, payload, 'utf8');
    return;
  }
  const previous = readFileSync(path);
  const needsBreak = previous.length > 0 && previous[previous.length - 1] !== 0x0a;
  appendFileSync(path, needsBreak ? `\n${payload}` : payload);
}
