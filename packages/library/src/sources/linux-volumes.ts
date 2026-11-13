// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Linux volumes (LNX1-SHL), for ADR 0001's "External drives": a location on a second drive (`/media/<user>/<label>`
 * as udisks2 mounts it, `/mnt/<name>`, `/data`) is online while that drive is mounted and offline while it isn't.
 *
 * A volume's identity is its filesystem UUID: the kernel's mount table (`/proc/self/mountinfo`) names each mount's
 * device, and udev's `/dev/disk/by-uuid` links name each device's UUID (its `by-label` links, the name shown). A
 * network mount (NFS, SMB, sshfs) has no UUID; `<type>:<source>` stands in, the same at every mount. A path's volume
 * is the mount whose mount point is the longest prefix of the path, symlinks resolved; a later mount over the same
 * point hides an earlier one. Pseudo filesystems (proc, tmpfs, overlay, a snap's squashfs) have no identity.
 */
import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { VolumeInfo, VolumeProbe } from './volume-probe';

/** What the probe reads, behind a port so tests replay a recorded machine. */
export interface LinuxMountSources {
  /** The text of /proc/self/mountinfo. */
  mountInfo(): Promise<string>;
  /** A /dev/disk/by-* folder: each link's name and the absolute path of the device it points at. */
  diskLinks(kind: 'by-uuid' | 'by-label'): Promise<ReadonlyMap<string, string>>;
  /** A device path with its symlinks resolved (/dev/mapper/data → /dev/dm-1); the path itself when it can't be. */
  realDevice(path: string): Promise<string>;
  /** A path with its symlinks resolved; rejects when it doesn't exist. */
  realPath(path: string): Promise<string>;
}

/** One row of mountinfo, as far as identity needs it. */
export interface MountRow {
  readonly mountPoint: string;
  readonly fsType: string;
  readonly source: string;
}

/** Filesystems whose source names the same share at every mount. */
const NETWORK_TYPES = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'fuse.sshfs', 'fuse.rclone']);

/** mountinfo escapes space, tab, newline and backslash as octal (\040); udev escapes link names as hex (\x20). */
const unescapeOctal = (field: string): string =>
  field.replace(/\\([0-7]{3})/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)));
const unescapeHex = (name: string): string =>
  name.replace(/\\x([0-9a-fA-F]{2})/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));

/**
 * `36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw,errors=continue` (proc(5)): the mount point is
 * the fifth field; after the optional fields and their `-`, the type and the source.
 */
export function parseMountInfo(text: string): MountRow[] {
  return text.split('\n').flatMap((line) => {
    const fields = line.trim().split(' ');
    const dash = fields.indexOf('-', 6);
    const mountPoint = fields[4];
    const fsType = fields[dash + 1];
    const source = fields[dash + 2];
    if (dash < 0 || !mountPoint || !fsType || source === undefined) return [];
    return [{ mountPoint: unescapeOctal(mountPoint), fsType, source: unescapeOctal(source) }];
  });
}

/** The mount holding `path` (absolute, symlinks resolved): the longest mount point, the later of two on one point. */
export function mountFor(rows: readonly MountRow[], path: string): MountRow | undefined {
  let found: MountRow | undefined;
  for (const row of rows) {
    const point = row.mountPoint;
    const holds = point === '/' || path === point || path.startsWith(`${point}/`);
    if (holds && (!found || point.length >= found.mountPoint.length)) found = row;
  }
  return found;
}

export function createLinuxVolumeProbe(sources: LinuxMountSources = procMountSources()): VolumeProbe {
  /** Device path → UUID and → label, for this read of the tables. */
  const tables = async () => {
    const invert = (links: ReadonlyMap<string, string>) =>
      new Map([...links].map(([name, device]) => [device, unescapeHex(name)] as const));
    const [uuids, labels] = await Promise.all([
      sources.diskLinks('by-uuid').then(invert, () => new Map<string, string>()),
      sources.diskLinks('by-label').then(invert, () => new Map<string, string>()),
    ]);
    return { uuids, labels };
  };

  const describe = async (row: MountRow, known: Awaited<ReturnType<typeof tables>>): Promise<VolumeInfo> => {
    const fallbackName = basename(row.mountPoint) || null;
    if (NETWORK_TYPES.has(row.fsType)) {
      return { uuid: `${row.fsType}:${row.source}`, name: fallbackName, mountPoint: row.mountPoint };
    }
    if (!row.source.startsWith('/dev/'))
      return { uuid: null, name: fallbackName, mountPoint: row.mountPoint };
    const device = await sources.realDevice(row.source);
    return {
      uuid: known.uuids.get(device) ?? null,
      name: known.labels.get(device) ?? fallbackName,
      mountPoint: row.mountPoint,
    };
  };

  return {
    async identify(path) {
      try {
        const real = await sources.realPath(path);
        const row = mountFor(parseMountInfo(await sources.mountInfo()), real);
        return row ? await describe(row, await tables()) : null;
      } catch {
        return null;
      }
    },
    async mountedUuids() {
      try {
        const [rows, known] = await Promise.all([sources.mountInfo().then(parseMountInfo), tables()]);
        const infos = await Promise.all(rows.map((row) => describe(row, known)));
        return new Set(infos.flatMap((info) => (info.uuid ? [info.uuid] : [])));
      } catch {
        return new Set();
      }
    },
  };
}

/** The real machine: /proc/self/mountinfo and udev's /dev/disk links. */
export function procMountSources(root = '/'): LinuxMountSources {
  return {
    mountInfo: () => readFile(resolve(root, 'proc/self/mountinfo'), 'utf8'),
    async diskLinks(kind) {
      const dir = resolve(root, 'dev/disk', kind);
      const names = await readdir(dir);
      const links = await Promise.all(
        names.map(async (name) => {
          const target = await readlink(resolve(dir, name)).catch(() => null);
          return target === null ? [] : [[name, resolve(dir, target)] as const];
        }),
      );
      return new Map(links.flat());
    },
    realDevice: (path) => realpath(path).catch(() => path),
    realPath: (path) => realpath(path),
  };
}
