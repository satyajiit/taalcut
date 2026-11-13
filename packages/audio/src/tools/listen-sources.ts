// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What lane B's listening tools read (EAR1-B1, B2): a library asset's original, or an audio artifact from an earlier
 * tool (a synthesised effect, a render's sound), as a file the jobs process can decode. An artifact is written to the
 * tool's scratch folder for the job and removed after it; nothing else is written.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  NotFoundError,
  ok,
  type ArtifactId,
  type ArtifactStore,
  type AssetId,
  type AsyncResult,
} from '@taalcut/core';
import { ListenBadInput } from '../listen/errors';

/** Library originals on disk (render's AssetFiles shape): null when the original is offline. */
export interface ListenAssetFiles {
  original(
    assetId: AssetId,
  ): AsyncResult<{ readonly path: string; readonly size: number; readonly mtimeMs: number } | null>;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export interface ResolvedSource {
  readonly path: string;
  /** For results: never a path. */
  readonly name: string;
  /** Removes what was written for the job (an artifact's copy); a no-op for an asset. */
  done(): Promise<void>;
}

export async function resolveListenSource(
  ref: { readonly assetId?: AssetId | undefined; readonly artifactId?: ArtifactId | undefined },
  deps: { readonly assets: ListenAssetFiles; readonly artifacts: ArtifactStore; readonly scratch: string },
): AsyncResult<ResolvedSource> {
  if (ref.assetId) {
    const original = await deps.assets.original(ref.assetId);
    if (!original.ok) return original;
    if (!original.value)
      return err(NotFoundError({ entity: 'asset', id: ref.assetId }, { detail: 'the original is offline' }));
    return ok({ path: original.value.path, name: `asset ${ref.assetId}`, done: async () => undefined });
  }
  if (!ref.artifactId) return err(ListenBadInput(undefined, { detail: 'give assetId or artifactId' }));
  const stored = await deps.artifacts.get(ref.artifactId);
  if (!stored.ok) return stored;
  const extension = EXTENSIONS[stored.value.ref.mediaType.split(';')[0]?.trim() ?? ''];
  if (!extension) {
    return err(
      ListenBadInput(undefined, {
        detail: `artifact ${ref.artifactId} is ${stored.value.ref.mediaType}, not audio`,
      }),
    );
  }
  const dir = join(deps.scratch, `listen-${randomUUID()}`);
  const path = join(dir, `artifact.${extension}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, stored.value.data);
  } catch (cause) {
    await rm(dir, { recursive: true, force: true });
    return err(
      ListenBadInput(undefined, { detail: `could not write the artifact: ${String(cause)}`.slice(0, 300) }),
    );
  }
  return ok({
    path,
    name: `artifact ${ref.artifactId}`,
    done: () => rm(dir, { recursive: true, force: true }),
  });
}
