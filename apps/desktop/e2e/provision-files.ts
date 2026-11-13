// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How e2e:provision (provision-assets.ts) puts a component's file in the component cache. The bytes are the ones the
 * signed manifest lists, and the mode is the one its install spec gives: a single file marked executable (whisper-cli,
 * whisper-server) is 0755, everything else 0644, as packages/jobs's component manager installs them. The mode is set
 * on the partial file, before the rename gives it its name.
 *
 * A file already in the cache is right only with the right bytes and the right mode. One with the right bytes and the
 * wrong mode has its mode set and stays. UX2 round 6: downloads were written 0644 and a re-run called them right, so
 * the audio tests, which fall back to this cache, ran a whisper-server the OS refused to start.
 */
import { createHash } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import type { ComponentManifest } from '@taalcut/jobs';

export type Artifact = ComponentManifest['components'][number]['artifacts'][number];

/** 0755 for a single file the manifest marks executable; 0644 for any other file and for archives. */
export function installMode(artifact: Artifact): number {
  return artifact.install.type === 'file' && artifact.install.executable ? 0o755 : 0o644;
}

export const octal = (mode: number) => `0${(mode & 0o777).toString(8)}`;

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export type Holding =
  | { readonly state: 'right' }
  | { readonly state: 'repaired'; readonly from: number }
  | { readonly state: 'absent' | 'other' };

/** Whether `path` holds the artifact: its bytes and its mode. Right bytes with the wrong mode get the mode. */
export async function holds(path: string, artifact: Artifact): Promise<Holding> {
  if (!existsSync(path)) return { state: 'absent' };
  const stat = statSync(path);
  if (stat.size !== artifact.size || (await fileSha256(path)) !== artifact.sha256) return { state: 'other' };
  const mode = installMode(artifact);
  if ((stat.mode & 0o777) === mode) return { state: 'right' };
  chmodSync(path, mode);
  return { state: 'repaired', from: stat.mode & 0o777 };
}

export interface Downloaded {
  readonly url: string;
  readonly size: number;
}

/**
 * Downloads the artifact to `target` from its first URL that answers, through `target.partial`, which takes the
 * install mode before it is renamed. Throws on any other size or sha256, or when no URL serves it.
 */
export async function download(
  artifact: Artifact,
  target: string,
  fetchUrl: (url: string) => Promise<Response> = fetch,
  warn: (line: string) => void = console.warn,
): Promise<Downloaded> {
  const partial = `${target}.partial`;
  for (const url of artifact.urls) {
    const response = await fetchUrl(url);
    if (!response.ok || !response.body) {
      warn(`${url} answered ${response.status}`);
      continue;
    }
    const hash = createHash('sha256');
    let size = 0;
    const file = await open(partial, 'w');
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        size += chunk.byteLength;
        await file.write(chunk);
      }
      // On the handle, so the process's umask doesn't decide it.
      await file.chmod(installMode(artifact));
    } finally {
      await file.close();
    }
    const digest = hash.digest('hex');
    if (size !== artifact.size || digest !== artifact.sha256) {
      rmSync(partial, { force: true });
      const expected = `${artifact.size} bytes, sha256 ${artifact.sha256}`;
      throw new Error(`${url} sent ${size} bytes, sha256 ${digest}; the manifest says ${expected}`);
    }
    renameSync(partial, target);
    return { url, size };
  }
  throw new Error('no URL served it');
}
