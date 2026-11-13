// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Debris a crash or an old manifest leaves in the components folder: staging folders, installed folders the
 * registry doesn't point to, partial downloads (artifacts and licence notices) of versions no longer in the
 * manifest, and the temp files of an atomic write that was cut short. Components with an install running are left
 * alone.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { removeQuietly } from './fs-util';
import { artifactKey, idOfEntry, type ComponentLayout } from './layout';
import type { ComponentManifest } from './manifest';
import type { InstalledRegistry } from './registry';
import { selectArtifact } from './selection';

/** The files kept beside the registry, whose interrupted atomic writes leave `<name>.<random>.tmp`. */
const STATE_TEMP = /^(registry|failures|downloads)\.json\..+\.tmp$/;

export async function sweepDebris(options: {
  readonly layout: ComponentLayout;
  readonly registry: InstalledRegistry;
  readonly manifest: ComponentManifest;
  readonly platform: string;
  readonly busy: (id: string) => boolean;
}): Promise<void> {
  const { layout, registry, manifest, platform, busy } = options;
  await removeEntries(layout.stagingDir, (name) => !busy(idOfEntry(name)));
  const keep = new Set(registry.list().map((e) => e.dir));
  for (const id of await listDir(layout.installedDir)) {
    if (busy(id)) continue;
    const versions = await listDir(join(layout.installedDir, id));
    const referenced = versions.filter((v) => keep.has(`installed/${id}/${v}`));
    if (referenced.length === 0) await removeQuietly(join(layout.installedDir, id));
    else
      for (const v of versions)
        if (!referenced.includes(v)) await removeQuietly(join(layout.installedDir, id, v));
  }
  const current = new Set(
    manifest.components.flatMap((c) => {
      const artifact = selectArtifact(c, platform);
      return artifact
        ? [
            artifactKey(c.id, c.version, artifact.sha256),
            `${artifactKey(c.id, c.version, c.licence.notice.sha256)}.notice`,
          ]
        : [];
    }),
  );
  await removeEntries(layout.downloadsDir, (name) => {
    if (busy(idOfEntry(name))) return false;
    return !current.has(name.replace(/\.(part|part\.json|download)$/, ''));
  });
  await removeEntries(layout.root, (name) => STATE_TEMP.test(name));
}

/** Deletes the entries of `dir` that `shouldRemove` picks. */
export async function removeEntries(dir: string, shouldRemove: (name: string) => boolean): Promise<void> {
  for (const name of await listDir(dir)) if (shouldRemove(name)) await removeQuietly(join(dir, name));
}

/** A folder's entries; none when it is missing or unreadable (the sweep then has nothing to do there). */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
