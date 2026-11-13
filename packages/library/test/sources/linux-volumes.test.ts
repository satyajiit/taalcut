// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Linux volume probe (LNX1-SHL) against recorded mount tables (linux-mounts/). `rtx4090.*` were recorded on the
 * LNX1 host, Ubuntu 24.04.5: /proc/self/mountinfo's rows a library location can be on (/, /data, /data/sata,
 * /boot/efi) and one of each kind the probe skips (proc, devtmpfs, tmpfs, a snap's squashfs, a Docker overlay with
 * its layer paths cut), and udev's /dev/disk/by-uuid and by-label links, resolved. `plugged.*` are the same tables
 * with three mounts added as the system makes them: a USB drive udisks2 mounted at /media/satyajit/Footage Drive
 * (exFAT; the kernel escapes the space as \040, udev as \x20), a LUKS volume at /mnt/archive behind
 * /dev/mapper/archive (/dev/dm-0), and an NFS share at /mnt/nas.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createLinuxVolumeProbe,
  createVolumeProbe,
  mountFor,
  parseMountInfo,
  procMountSources,
  type LinuxMountSources,
} from '../../src/index';
import { tempDir } from '../helpers';
import { library, writeMedia } from './fixture';

const HERE = join(import.meta.dirname, 'linux-mounts');
const ROOT = 'd91d0717-df55-4a72-8c95-ddb73f0eeb83';
const DATA = '1bb5f06c-76c9-4d16-9ba5-2f1e00d083a8';
const SATA = 'eadd4ca0-5cce-4dd9-a8a0-e37ef6d5da8a';
const EFI = 'E8E3-CFAA';
const USB = '5E2A-91C4';
const LUKS = '7f3c2a10-0b6e-4a1e-9d55-3c1f0e8a9b21';
const USB_ROOT = '/media/satyajit/Footage Drive';

interface Machine {
  readonly mountinfo: string;
  readonly links: { readonly 'by-uuid': Record<string, string>; readonly 'by-label': Record<string, string> };
}

const recorded = (name: 'rtx4090' | 'plugged'): Machine => ({
  mountinfo: readFileSync(join(HERE, `${name}.mountinfo`), 'utf8'),
  links: JSON.parse(readFileSync(join(HERE, `${name}.disk-links.json`), 'utf8')) as Machine['links'],
});

/** A recorded machine; `realPath` maps a test's own folders into it, and /dev/mapper resolves as udev links it. */
function sources(
  machine: () => Machine,
  realPath: (path: string) => string = (path) => path,
): LinuxMountSources {
  return {
    mountInfo: async () => machine().mountinfo,
    diskLinks: async (kind) => new Map(Object.entries(machine().links[kind])),
    realDevice: async (path) => (path === '/dev/mapper/archive' ? '/dev/dm-0' : path),
    realPath: async (path) => realPath(path),
  };
}

describe('parseMountInfo', () => {
  it('reads the mount point, type and source past the optional fields, unescaping \\040', () => {
    const rows = parseMountInfo(recorded('plugged').mountinfo);
    expect(rows).toContainEqual({ mountPoint: '/', fsType: 'ext4', source: '/dev/nvme1n1p2' });
    expect(rows).toContainEqual({ mountPoint: '/data/sata', fsType: 'ext4', source: '/dev/sda1' });
    expect(rows).toContainEqual({ mountPoint: USB_ROOT, fsType: 'exfat', source: '/dev/sdb1' });
    expect(rows).toContainEqual({
      mountPoint: '/mnt/nas',
      fsType: 'nfs4',
      source: 'nas.local:/volume1/footage',
    });
    expect(parseMountInfo('garbage\n\n')).toEqual([]);
  });

  it('finds the deepest mount holding a path; a later mount over the same point hides the earlier one', () => {
    const rows = parseMountInfo(recorded('rtx4090').mountinfo);
    expect(mountFor(rows, '/data/sata/clips/a.mov')?.mountPoint).toBe('/data/sata');
    expect(mountFor(rows, '/data/satay/a.mov')?.mountPoint).toBe('/data');
    expect(mountFor(rows, '/home/satyajit/Videos')?.mountPoint).toBe('/');
    const over = [...rows, { mountPoint: '/data', fsType: 'ext4', source: '/dev/sdc1' }];
    expect(mountFor(over, '/data/a.mov')?.source).toBe('/dev/sdc1');
  });
});

describe('createLinuxVolumeProbe on the recorded host', () => {
  const probe = createLinuxVolumeProbe(sources(() => recorded('rtx4090')));

  it('names each drive by its filesystem UUID and label', async () => {
    expect(await probe.identify('/data/footage/a.mov')).toEqual({
      uuid: DATA,
      name: 'nvme',
      mountPoint: '/data',
    });
    expect(await probe.identify('/data/sata/b.mov')).toEqual({
      uuid: SATA,
      name: 'data',
      mountPoint: '/data/sata',
    });
    expect(await probe.identify('/home/satyajit/Videos')).toEqual({
      uuid: ROOT,
      name: 'root',
      mountPoint: '/',
    });
  });

  it('lists the mounted drives, never a pseudo filesystem or a snap', async () => {
    expect(await probe.mountedUuids()).toEqual(new Set([ROOT, DATA, SATA, EFI]));
    expect(await probe.identify('/run/user/1000/x')).toEqual({
      uuid: null,
      name: '1000',
      mountPoint: '/run/user/1000',
    });
  });

  it('follows a symlink to the drive it points at, and knows nothing of a path that is not there', async () => {
    const linked = createLinuxVolumeProbe(
      sources(
        () => recorded('rtx4090'),
        (path) => path.replace('/home/satyajit/Footage', '/data/footage'),
      ),
    );
    expect((await linked.identify('/home/satyajit/Footage/a.mov'))?.uuid).toBe(DATA);
    const missing = createLinuxVolumeProbe({
      ...sources(() => recorded('rtx4090')),
      realPath: () => Promise.reject(new Error('ENOENT')),
    });
    expect(await missing.identify('/media/satyajit/Gone/a.mov')).toBeNull();
  });

  it('answers with nothing mounted rather than failing when the tables cannot be read', async () => {
    const broken = createLinuxVolumeProbe({
      ...sources(() => recorded('rtx4090')),
      mountInfo: () => Promise.reject(new Error('EACCES')),
    });
    expect(await broken.mountedUuids()).toEqual(new Set());
    expect(await broken.identify('/data/a.mov')).toBeNull();
  });
});

describe('createLinuxVolumeProbe with drives plugged in', () => {
  const probe = createLinuxVolumeProbe(sources(() => recorded('plugged')));

  it('identifies a USB drive by UUID with its label, a LUKS volume through its mapper, an NFS share by its source', async () => {
    expect(await probe.identify(`${USB_ROOT}/2026/clip.mp4`)).toEqual({
      uuid: USB,
      name: 'Footage Drive',
      mountPoint: USB_ROOT,
    });
    expect(await probe.identify('/mnt/archive/old.mov')).toEqual({
      uuid: LUKS,
      name: 'archive',
      mountPoint: '/mnt/archive',
    });
    expect((await probe.identify('/mnt/nas/a.mov'))?.uuid).toBe('nfs4:nas.local:/volume1/footage');
    expect(await probe.mountedUuids()).toEqual(
      new Set([ROOT, DATA, SATA, EFI, USB, LUKS, 'nfs4:nas.local:/volume1/footage']),
    );
  });
});

describe('a library location on a second drive', () => {
  it('is online while the drive is mounted, offline (never missing) while it is not, and online again', async () => {
    let machine = recorded('plugged');
    // A folder stands in for the drive's root: the probe sees it at /media/satyajit/Footage Drive.
    const folderRoot = join(realpathSync(tempDir()), 'Footage');
    mkdirSync(folderRoot);
    const lib = library({
      volumes: createLinuxVolumeProbe(
        sources(
          () => machine,
          (path) => path.replace(folderRoot, USB_ROOT),
        ),
      ),
    });
    const volume = await lib.volumes.identify(folderRoot);
    expect(volume).toEqual({ uuid: USB, name: 'Footage Drive', mountPoint: USB_ROOT });
    const source = unwrap(
      lib.repos.sources.add({
        kind: 'watched_folder',
        displayName: 'Footage Drive',
        rootPath: folderRoot,
        volumeUuid: volume!.uuid,
        volumeName: volume!.name,
      }),
    );
    writeMedia(folderRoot, 'clip.mov');
    await lib.scan({ sourceId: source.id, mode: 'full' });
    expect(unwrap(lib.repos.sources.get(source.id)).status).toBe('online');
    expect(lib.locations(source.id)).toMatchObject([{ state: 'present', availability: 'online' }]);

    // Unplugged: udisks2 unmounts it and removes /media/satyajit/Footage Drive.
    machine = recorded('rtx4090');
    rmSync(folderRoot, { recursive: true });
    expect(await lib.scan({ sourceId: source.id, mode: 'full' })).toMatchObject({ end: 'offline' });
    expect(unwrap(lib.repos.sources.get(source.id)).status).toBe('offline');
    expect(lib.locations(source.id)).toMatchObject([
      { state: 'offline', availability: 'offline', missingSince: null },
    ]);

    // Plugged in again.
    machine = recorded('plugged');
    mkdirSync(folderRoot);
    writeMedia(folderRoot, 'clip.mov');
    await lib.scan({ sourceId: source.id, mode: 'full' });
    expect(unwrap(lib.repos.sources.get(source.id)).status).toBe('online');
  });
});

describe('createVolumeProbe', () => {
  it('picks the Linux probe on Linux', async () => {
    // Every Linux machine has a root filesystem; elsewhere this only checks the choice compiles.
    const probe = createVolumeProbe('linux');
    if (process.platform === 'linux') expect((await probe.identify('/'))?.mountPoint).toBe('/');
    expect(probe).toBeDefined();
  });

  it.runIf(process.platform === 'linux')('reads this machine’s tables', async () => {
    const probe = createLinuxVolumeProbe(procMountSources());
    const root = await probe.identify('/');
    expect(root?.mountPoint).toBe('/');
    if (root?.uuid) expect(await probe.mountedUuids()).toContain(root.uuid);
  });
});
