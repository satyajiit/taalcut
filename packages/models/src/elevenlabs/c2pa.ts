// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether a generated file carries Content Credentials, read through core's ContentCredentials (render implements
 * it; it reads paths, so the bytes go to a private scratch file that is removed again). Without a reader the caller's
 * fallback stands: 'absent' for speech and sound effects (their APIs have no C2PA option), 'unknown' for music.
 * A read that fails is 'unknown': the file is never claimed signed or unsigned on a guess.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { C2paPresence, ContentCredentials } from '@taalcut/core';

export interface PresenceRead {
  readonly reader?: ContentCredentials;
  readonly bytes: Uint8Array;
  readonly extension: 'mp3' | 'wav';
  readonly fallback: C2paPresence;
  readonly signal?: AbortSignal;
  /** Where the scratch file goes. Default: the OS temp folder. */
  readonly scratchDir?: string;
}

export async function readPresence(read: PresenceRead): Promise<C2paPresence> {
  if (!read.reader) return read.fallback;
  const dir = await mkdtemp(join(read.scratchDir ?? tmpdir(), 'taalcut-c2pa-'));
  try {
    const path = join(dir, `generated.${read.extension}`);
    await writeFile(path, read.bytes);
    const result = await read.reader.read(path, read.signal);
    return result.ok ? result.value.presence : 'unknown';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What a provider needs to read a generated file's credentials: the reader and, optionally, where to put the copy. */
export interface PresenceDeps {
  readonly contentCredentials?: ContentCredentials;
  readonly scratchDir?: string;
}

/** The credentials of a generated MP3, or `fallback` with no reader. */
export function generatedPresence(
  deps: PresenceDeps,
  bytes: Uint8Array,
  fallback: C2paPresence,
  signal?: AbortSignal,
): Promise<C2paPresence> {
  return readPresence({
    ...(deps.contentCredentials ? { reader: deps.contentCredentials } : {}),
    ...(deps.scratchDir ? { scratchDir: deps.scratchDir } : {}),
    ...(signal ? { signal } : {}),
    bytes,
    extension: 'mp3',
    fallback,
  });
}
