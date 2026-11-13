// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The channel file electron-updater 6.8 reads (latest-mac.yml, beta-mac.yml), written and read only by these
 * release scripts (docs/release.md, "What goes where on GitHub Releases"). One fixed shape, so it is rendered and
 * parsed here without a YAML library: every key on its own line, strings single-quoted (YAML 1.2), the release
 * notes a one-line JSON string. The parser accepts exactly what the renderer writes and refuses anything else,
 * so a hand-edited or foreign file stops a workflow instead of being half-understood. The website's checksum step
 * reads the `version:` line of the same file.
 */

export interface ChannelEntry {
  readonly version: string;
  /** Absolute URL of the versioned zip (`.../releases/download/v<version>/Taalcut-<version>-arm64-mac.zip`). */
  readonly url: string;
  /** base64 sha512 of the zip, as electron-updater checks it. */
  readonly sha512: string;
  readonly size: number;
  readonly blockMapSize?: number;
  /** ISO 8601. */
  readonly releaseDate: string;
  /** The four languages as one JSON string (release-notes.ts). */
  readonly releaseNotes?: string;
  /** 1–99; absent means everyone. */
  readonly stagingPercentage?: number;
}

export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:beta|alpha|internal)\.\d+)?$/;
const SHA512 = /^[A-Za-z0-9+/]{86}==$/;

function quote(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('channel yml strings are one line');
  return `'${value.replaceAll("'", "''")}'`;
}

function unquote(value: string): string {
  const match = /^'((?:[^']|'')*)'$/.exec(value);
  if (!match || match[1] === undefined) throw new Error(`expected a single-quoted string, got ${value}`);
  return match[1].replaceAll("''", "'");
}

export function checkEntry(entry: ChannelEntry): ChannelEntry {
  if (!VERSION_PATTERN.test(entry.version)) throw new Error(`not a release version: ${entry.version}`);
  const url = new URL(entry.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
    throw new Error(`zip URL must be https: ${entry.url}`);
  }
  if (!url.pathname.endsWith(`/Taalcut-${entry.version}-arm64-mac.zip`)) {
    throw new Error(`zip URL must name Taalcut-${entry.version}-arm64-mac.zip (delta updates find the old blockmap by version)`);
  }
  if (!SHA512.test(entry.sha512)) throw new Error('sha512 must be base64 of 64 bytes');
  if (!Number.isInteger(entry.size) || entry.size <= 0) throw new Error('size must be a positive integer');
  if (entry.blockMapSize !== undefined && (!Number.isInteger(entry.blockMapSize) || entry.blockMapSize <= 0)) {
    throw new Error('blockMapSize must be a positive integer');
  }
  if (Number.isNaN(Date.parse(entry.releaseDate))) throw new Error(`releaseDate is not a date: ${entry.releaseDate}`);
  const stage = entry.stagingPercentage;
  if (stage !== undefined && (!Number.isInteger(stage) || stage < 1 || stage > 99)) {
    throw new Error(`stagingPercentage must be 1–99 (100 means no field): ${stage}`);
  }
  return entry;
}

export function renderChannelYml(input: ChannelEntry): string {
  const entry = checkEntry(input);
  const lines = [
    `version: ${entry.version}`,
    'files:',
    `  - url: ${quote(entry.url)}`,
    `    sha512: ${quote(entry.sha512)}`,
    `    size: ${entry.size}`,
    ...(entry.blockMapSize !== undefined ? [`    blockMapSize: ${entry.blockMapSize}`] : []),
    `path: ${quote(entry.url)}`,
    `sha512: ${quote(entry.sha512)}`,
    `releaseDate: ${quote(entry.releaseDate)}`,
    ...(entry.releaseNotes !== undefined ? [`releaseNotes: ${quote(entry.releaseNotes)}`] : []),
    ...(entry.stagingPercentage !== undefined ? [`stagingPercentage: ${entry.stagingPercentage}`] : []),
  ];
  return `${lines.join('\n')}\n`;
}

const KEYS = ['version', 'path', 'sha512', 'releaseDate', 'releaseNotes', 'stagingPercentage'] as const;
const FILE_KEYS = ['url', 'sha512', 'size', 'blockMapSize'] as const;

export function parseChannelYml(text: string): ChannelEntry {
  const top = new Map<string, string>();
  const file = new Map<string, string>();
  let inFiles = false;
  let files = 0;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    if (line === 'files:') {
      inFiles = true;
      continue;
    }
    const item = /^ {2}- (\w+): (.+)$/.exec(line) ?? /^ {4}(\w+): (.+)$/.exec(line);
    if (inFiles && item?.[1] && item[2] !== undefined) {
      if (line.startsWith('  - ')) files += 1;
      if (files !== 1) throw new Error('a channel yml lists exactly one file (the arm64 zip)');
      if (!(FILE_KEYS as readonly string[]).includes(item[1]) || file.has(item[1])) {
        throw new Error(`unexpected file key: ${item[1]}`);
      }
      file.set(item[1], item[2]);
      continue;
    }
    inFiles = false;
    const pair = /^(\w+): (.+)$/.exec(line);
    if (!pair?.[1] || pair[2] === undefined || !(KEYS as readonly string[]).includes(pair[1]) || top.has(pair[1])) {
      throw new Error(`unexpected line in channel yml: ${line.slice(0, 80)}`);
    }
    top.set(pair[1], pair[2]);
  }
  const required = (map: Map<string, string>, key: string) => {
    const value = map.get(key);
    if (value === undefined) throw new Error(`channel yml has no ${key}`);
    return value;
  };
  const url = unquote(required(file, 'url'));
  const sha512 = unquote(required(file, 'sha512'));
  if (unquote(required(top, 'path')) !== url || unquote(required(top, 'sha512')) !== sha512) {
    throw new Error('the legacy path and sha512 must repeat the file entry');
  }
  const blockMapSize = file.get('blockMapSize');
  const notes = top.get('releaseNotes');
  const stage = top.get('stagingPercentage');
  return checkEntry({
    version: required(top, 'version'),
    url,
    sha512,
    size: Number(required(file, 'size')),
    ...(blockMapSize !== undefined ? { blockMapSize: Number(blockMapSize) } : {}),
    releaseDate: unquote(required(top, 'releaseDate')),
    ...(notes !== undefined ? { releaseNotes: unquote(notes) } : {}),
    ...(stage !== undefined ? { stagingPercentage: Number(stage) } : {}),
  });
}
