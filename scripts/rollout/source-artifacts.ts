// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const SOURCE_METADATA = 'ffmpeg-source-distribution.json';

interface SourceDistribution {
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

/** The source archive is a named, immutable artifact, never an arbitrary path or download destination. */
export function readSourceDistribution(file: string): SourceDistribution {
  const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<SourceDistribution>;
  if (typeof value.url !== 'string' || typeof value.sha256 !== 'string' || typeof value.size !== 'number')
    throw new Error('invalid FFmpeg source distribution metadata');
  const url = new URL(value.url);
  if (
    url.origin !== 'https://components.taalcut.app' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/ffmpeg\/[0-9.]+\/source\/ffmpeg-[0-9.]+-source-[a-f0-9]{16}\.tar\.zst$/.test(url.pathname) ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  )
    throw new Error('unsafe FFmpeg source distribution metadata');
  return { url: value.url, sha256: value.sha256, size: value.size };
}

/** Local test feeds may omit source; a GitHub publication must carry it beside its executable downloads. */
export function sourceArtifacts(directory: string, required = false): string[] {
  const metadata = join(directory, SOURCE_METADATA);
  if (!existsSync(metadata) && !required) return [];
  if (!existsSync(metadata)) throw new Error(`missing ${SOURCE_METADATA}; run scripts/release-source.mjs`);
  if (!lstatSync(metadata).isFile() || lstatSync(metadata).isSymbolicLink())
    throw new Error('unsafe FFmpeg source distribution metadata');
  const source = readSourceDistribution(metadata);
  const archive = join(directory, basename(new URL(source.url).pathname));
  if (!existsSync(archive) || !lstatSync(archive).isFile() || lstatSync(archive).isSymbolicLink())
    throw new Error('missing or unsafe FFmpeg corresponding-source archive');
  const bytes = readFileSync(archive);
  if (bytes.length !== source.size || createHash('sha256').update(bytes).digest('hex') !== source.sha256)
    throw new Error('FFmpeg corresponding-source archive checksum mismatch');
  return [metadata, archive];
}

/** Bind corresponding source to the actual unsigned build record retained inside the signed app. */
export function assertSourceBuild(metadata: string, buildinfo: string, platform: string): void {
  const value = JSON.parse(readFileSync(metadata, 'utf8')) as {
    platforms?: readonly { platform: string; buildinfoSha256: string }[];
  };
  const entry = Array.isArray(value.platforms)
    ? value.platforms.find((row) => row.platform === platform)
    : undefined;
  const actual = createHash('sha256').update(readFileSync(buildinfo)).digest('hex');
  if (!entry || entry.buildinfoSha256 !== actual)
    throw new Error(`FFmpeg corresponding source does not match ${platform} BUILDINFO`);
}
