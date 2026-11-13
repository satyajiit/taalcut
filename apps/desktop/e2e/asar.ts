// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reads an app.asar without extracting it, to check what a package ships.
 * Format: a pickled UInt32 header size, then a pickled JSON header (string
 * length + JSON), then the file contents at the offsets the header gives.
 */
import { readFileSync } from 'node:fs';

interface AsarEntry {
  readonly files?: Record<string, AsarEntry>;
  readonly size?: number;
  readonly offset?: string;
  readonly unpacked?: boolean;
}

export interface Asar {
  /** Every file path, e.g. 'out/main/index.mjs', with whether it is unpacked. */
  readonly files: ReadonlyMap<string, { readonly unpacked: boolean }>;
  readText(path: string): string;
}

export function openAsar(path: string): Asar {
  const bytes = readFileSync(path);
  const headerPickleSize = bytes.readUInt32LE(4);
  const jsonLength = bytes.readUInt32LE(12);
  const header = JSON.parse(bytes.subarray(16, 16 + jsonLength).toString('utf8')) as AsarEntry;
  const base = 8 + headerPickleSize;

  const files = new Map<string, { unpacked: boolean }>();
  const entries = new Map<string, AsarEntry>();
  const walk = (entry: AsarEntry, prefix: string) => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      const childPath = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, childPath);
      else {
        files.set(childPath, { unpacked: child.unpacked === true });
        entries.set(childPath, child);
      }
    }
  };
  walk(header, '');

  return {
    files,
    readText(file) {
      const entry = entries.get(file);
      if (!entry || entry.unpacked || entry.offset === undefined || entry.size === undefined) {
        throw new Error(`${file} is not packed in the archive`);
      }
      const start = base + Number(entry.offset);
      return bytes.subarray(start, start + entry.size).toString('utf8');
    },
  };
}
