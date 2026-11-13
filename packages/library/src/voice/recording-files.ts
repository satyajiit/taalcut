// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The consent store's recording files: `<dir>/<consentId>.wav`, the folder 0700 and each file 0600, like main's
 * captures folder. A capture moves in by rename; across volumes (a userData on another disk than the captures
 * folder, which main never does today) by copy, fsync and unlink. Throws Node's errors; the store turns them into
 * error values.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ULID_PATTERN, type VoiceConsentId } from '@taalcut/core';
import { fsyncPath, moveFile } from '../files/durable-files';
import { isFile } from '../files/file-presence';

const RECORDING_NAME = new RegExp(`^(${ULID_PATTERN.source.slice(1, -1)})\\.wav$`);

export function recordingFile(dir: string, id: VoiceConsentId): string {
  return join(dir, `${id}.wav`);
}

/** The consent ids the folder holds a recording for (`<ulid>.wav` files; anything else is left alone). */
async function recordingIds(dir: string): Promise<VoiceConsentId[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
    throw cause;
  }
  return entries.flatMap((entry) => {
    const id = entry.isFile() ? RECORDING_NAME.exec(entry.name)?.[1] : undefined;
    return id ? [id as VoiceConsentId] : [];
  });
}

/** Hex sha256 of the whole file, streamed (recordings run to 10 minutes of 48 kHz PCM). */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Moves `from` to `to` (never over an existing file across volumes), leaving it 0600, and fsyncs `to`'s folder so
 * the name is on disk before anything records it. A move that fails part way takes a half-copied `to` with it.
 */
export async function moveRecording(from: string, to: string, dir: string): Promise<void> {
  try {
    await moveFile(from, to);
  } catch (cause) {
    // The move's own error is the one to report; a half copy that can't even be looked at is left for the
    // store's orphan sweep at its next start.
    if (await isFile(to).catch(() => false)) await rm(to, { force: true });
    throw cause;
  }
  await chmod(to, 0o600);
  await fsyncPath(dir);
}

export async function prepareDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function removeRecording(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Removes the recordings `listed` doesn't know: what a kill between a recording's move and its row leaves. */
export async function removeOrphanRecordings(
  dir: string,
  listed: (id: VoiceConsentId) => boolean,
): Promise<void> {
  for (const id of await recordingIds(dir)) {
    if (!listed(id)) await removeRecording(recordingFile(dir, id));
  }
}
