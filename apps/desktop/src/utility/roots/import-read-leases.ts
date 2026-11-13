// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { isAbsolute, join } from 'node:path';
import { err, newId, toTaalcutError, type JobHandler } from '@taalcut/core';
import { createImportReaderRegistry, type LibraryDatabase, type VolumeProbe } from '@taalcut/library';

/** Normal scanning, hashing and preview/index jobs share the same eject barrier as imports. */
export function withImportReadLeases(
  db: LibraryDatabase,
  volumes: VolumeProbe,
  handler: JobHandler<unknown, unknown>,
  extraPaths?: () => Promise<readonly string[]>,
): JobHandler<unknown, unknown> {
  const readers = createImportReaderRegistry(db);
  return async (input, context) => {
    const owner = `job:${context.jobId}:${newId<'ImportReader'>()}`;
    try {
      const identities = await sourceVolumes(db, volumes, input, await extraPaths?.());
      for (const volume of identities) {
        const acquired = readers.acquire(owner, volume);
        if (!acquired.ok) return acquired;
      }
      return await handler(input, context);
    } catch (cause) {
      return err(toTaalcutError(cause));
    } finally {
      // Aborting alone does not release a reader; the worker must finish unwinding its native reads first.
      readers.releaseOwner(owner);
    }
  };
}

async function sourceVolumes(
  db: LibraryDatabase,
  probe: VolumeProbe,
  input: unknown,
  extraPaths: readonly string[] = [],
): Promise<Set<string>> {
  const sources = new Set<string>();
  const assets = new Set<string>();
  const paths = new Set(extraPaths.filter(isAbsolute));
  collect(input, sources, assets, paths);
  const volumes = new Set<string>();
  const rows = [
    ...db.driver
      .prepare(
        `SELECT volume_uuid AS volume, root_path AS path FROM sources
      WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify([...sources])),
    ...db.driver
      .prepare(
        `SELECT COALESCE(l.volume_uuid, s.volume_uuid) AS volume,
      l.absolute_path_cached AS path, s.root_path, l.relative_path
      FROM asset_locations l JOIN sources s ON s.id=l.source_id
      WHERE l.asset_id IN (SELECT value FROM json_each(?))
         OR l.absolute_path_cached IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify([...assets]), JSON.stringify([...paths])),
  ];
  for (const row of rows) {
    const path =
      typeof row.path === 'string'
        ? row.path
        : typeof row.root_path === 'string' && typeof row.relative_path === 'string'
          ? join(row.root_path, row.relative_path)
          : undefined;
    if (typeof row.volume === 'string') {
      volumes.add(row.volume);
      if (path) paths.add(path);
    } else if (path) paths.add(path);
  }
  for (const path of paths) {
    const volume = await probe.identify(path);
    if (volume?.uuid) volumes.add(volume.uuid);
  }
  return volumes;
}

/** Public job inputs carry IDs or explicit local paths; no arbitrary string is interpreted as a path. */
function collect(
  value: unknown,
  sources: Set<string>,
  assets: Set<string>,
  paths: Set<string>,
  depth = 0,
): void {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, sources, assets, paths, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const strings =
      typeof entry === 'string'
        ? [entry]
        : Array.isArray(entry)
          ? entry.filter((item): item is string => typeof item === 'string')
          : [];
    if (key === 'sourceId' || key === 'sourceIds') for (const id of strings) sources.add(id);
    else if (key === 'assetId' || key === 'assetIds') for (const id of strings) assets.add(id);
    else if (/^(path|paths|searchIn|root|roots)$|Path$/.test(key))
      for (const path of strings) if (isAbsolute(path)) paths.add(path);
    collect(entry, sources, assets, paths, depth + 1);
  }
}
