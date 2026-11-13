// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each manifest track downloaded once into a cache folder outside the repository (default
 * ~/.cache/taalcut-ear1/listen-mood), checked against its sha256 and size; a mismatch stops the eval. Nothing is
 * uploaded and nothing is committed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import type { MoodTrack } from './manifest';

export const MOOD_CACHE =
  process.env.TAALCUT_LISTEN_MOOD_CACHE ?? join(homedir(), '.cache', 'taalcut-ear1', 'listen-mood');

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function checked(track: MoodTrack, bytes: Uint8Array): Uint8Array {
  if (bytes.length !== track.bytes) throw new Error(`${track.id}: ${bytes.length} bytes, not ${track.bytes}`);
  if (sha256(bytes) !== track.sha256) throw new Error(`${track.id}: sha256 differs from the manifest`);
  return bytes;
}

/** The track's local path, downloading it first when it isn't cached. */
export async function fetchTrack(track: MoodTrack, dir = MOOD_CACHE): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${track.id}${extname(new URL(track.url).pathname) || '.audio'}`);
  if (existsSync(path)) {
    checked(track, readFileSync(path));
    return path;
  }
  const response = await fetch(track.url);
  if (!response.ok) throw new Error(`${track.id}: HTTP ${response.status}`);
  writeFileSync(path, checked(track, new Uint8Array(await response.arrayBuffer())));
  return path;
}
