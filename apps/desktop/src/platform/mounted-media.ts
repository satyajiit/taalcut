// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { err, ok, toTaalcutError, ValidationError, type AsyncResult } from '@taalcut/core';

export interface MountedMedia {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly volume: string;
  readonly disk: string;
  readonly physicalDisks: readonly string[];
  readonly removable: boolean;
}
export interface MountedMediaPort {
  list(): AsyncResult<readonly MountedMedia[]>;
  eject(media: MountedMedia): AsyncResult<void>;
}

const run = promisify(execFile);
const unescapeXml = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) =>
    entity.startsWith('#')
      ? String.fromCodePoint(
          entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
        )
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? entity),
  );
const stringValue = (text: string, key: string) => {
  const value = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(text)?.[1];
  return value === undefined ? undefined : unescapeXml(value);
};
const boolValue = (text: string, key: string) => new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(text);

/** Decode diskutil's plist strings before comparing mounted names (for example "Video & Photos"). */
export function parseMountedMedia(path: string, plist: string): Omit<MountedMedia, 'physicalDisks'> | null {
  if (boolValue(plist, 'Internal')) return null;
  const volume = stringValue(plist, 'VolumeUUID');
  const mount = stringValue(plist, 'MountPoint');
  const disk = stringValue(plist, 'ParentWholeDisk') ?? stringValue(plist, 'DeviceIdentifier');
  if (!volume || !disk || mount !== path) return null;
  return {
    id: createHash('sha256').update(volume).digest('hex'),
    label: stringValue(plist, 'VolumeName') ?? path.split('/').at(-1)!,
    path,
    volume,
    disk,
    removable:
      boolValue(plist, 'Removable') || boolValue(plist, 'RemovableMedia') || boolValue(plist, 'Ejectable'),
  };
}

/** A multi-store container links every overlapping volume, including siblings on either physical disk. */
export function mountedEjectVolumes(source: MountedMedia, media: readonly MountedMedia[]): string[] {
  const disks = new Set(source.physicalDisks);
  const volumes = new Set([source.volume]);
  let before;
  do {
    before = disks.size;
    for (const candidate of media) {
      if (!candidate.physicalDisks.some((disk) => disks.has(disk))) continue;
      volumes.add(candidate.volume);
      for (const disk of candidate.physicalDisks) disks.add(disk);
    }
  } while (disks.size !== before);
  return [...volumes];
}

const describeDisk = async (target: string) =>
  (await run('/usr/sbin/diskutil', ['info', '-plist', target], { timeout: 10000 })).stdout;
const mountedPaths = async () =>
  (await readdir('/Volumes', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('/Volumes', entry.name));

/** Only external mounted filesystems; an unresolved sibling makes the inventory unsafe for whole-disk eject. */
export function createMacMountedMediaPort(
  options: {
    readonly paths?: () => Promise<readonly string[]>;
    readonly describe?: (target: string) => Promise<string>;
  } = {},
): MountedMediaPort {
  return {
    async list() {
      try {
        const paths = await (options.paths ?? mountedPaths)();
        const describe = options.describe ?? describeDisk;
        const physical = new Map<string, string>();
        const media: MountedMedia[] = [];
        for (const path of paths) {
          const plist = await describe(path);
          if (boolValue(plist, 'Internal')) continue;
          const source = parseMountedMedia(path, plist);
          if (!source) return err(ValidationError({ field: 'mountedMedia' }));
          const stores = [
            ...plist.matchAll(/<key>APFSPhysicalStore<\/key>\s*<string>([^<]+)<\/string>/g),
          ].map((match) => unescapeXml(match[1]!));
          const apfs =
            stringValue(plist, 'APFSContainerReference') !== undefined ||
            stringValue(plist, 'FilesystemType') === 'apfs';
          if (apfs && !stores.length) return err(ValidationError({ field: 'physicalStores' }));
          const disks = new Set<string>();
          for (const store of stores) {
            let disk = physical.get(store);
            if (!disk) {
              const info = await describe(store);
              disk =
                stringValue(info, 'ParentWholeDisk') ??
                (boolValue(info, 'WholeDisk') ? stringValue(info, 'DeviceIdentifier') : undefined);
              if (!disk || !/^disk\d+$/.test(disk)) return err(ValidationError({ field: 'physicalStore' }));
              physical.set(store, disk);
            }
            disks.add(disk);
          }
          if (!stores.length) {
            if (!/^disk\d+$/.test(source.disk)) return err(ValidationError({ field: 'physicalDisk' }));
            disks.add(source.disk);
          }
          media.push({ ...source, physicalDisks: [...disks] });
        }
        return ok(media);
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
    async eject(media) {
      try {
        await run('/usr/sbin/diskutil', ['eject', media.path], { timeout: 30000 });
        return ok(undefined);
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
  };
}

export const unavailableMountedMediaPort = (): MountedMediaPort => ({
  list: async () => ok([]),
  eject: async () => err(toTaalcutError(new Error('Mounted media eject unavailable'))),
});
