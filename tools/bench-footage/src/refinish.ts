// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs the finishing step (encode.ts `finishArgs`: a stream copy with the phone's metadata) again over a set that is
 * already generated, without encoding anything, and updates its manifest's sizes and checksums. For a fix to the
 * metadata only: ix-v1's .mp4 clips were finished with their creation time written twice (2026-10-17), and
 * re-encoding the set would put its HEVC through VideoToolbox again.
 */
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { finishArgs } from './encode';
import type { FootageTools } from './generate';
import { MANIFEST_FILE, readManifest, sha256, specHash, type Manifest } from './manifest';
import { planClip } from './plan';
import type { FootageSet } from './sets/types';

export async function refinishSet(
  set: FootageSet,
  dir: string,
  tools: Pick<FootageTools, 'ffmpeg'>,
  which: (file: string) => boolean = () => true,
): Promise<Manifest> {
  const manifest = readManifest(dir);
  if (manifest.specHash !== specHash(set)) throw new Error(`${dir} holds another version of ${set.name}`);
  const clips = [];
  for (const entry of manifest.clips) {
    const clip = set.clips.find((spec) => spec.file === entry.file);
    if (clip === undefined || !which(entry.file)) {
      clips.push(entry);
      continue;
    }
    const path = join(dir, entry.file);
    const next = join(dir, `.refinish${extname(entry.file)}`);
    rmSync(next, { force: true });
    await tools.ffmpeg(finishArgs(planClip(set, clip), path, next));
    renameSync(next, path);
    clips.push({ ...entry, bytes: statSync(path).size, sha256: await sha256(path) });
  }
  const next: Manifest = { ...manifest, clips };
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
