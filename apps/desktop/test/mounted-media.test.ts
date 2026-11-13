// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import {
  createMacMountedMediaPort,
  mountedEjectVolumes,
  parseMountedMedia,
} from '../src/platform/mounted-media';

it('discovers escaped names and retains the whole disk identity for sibling-volume eject guards', () => {
  const source = parseMountedMedia(
    '/Volumes/Video & Photos',
    `<plist><dict>
    <key>Internal</key><false/><key>VolumeUUID</key><string>volume-one</string>
    <key>MountPoint</key><string>/Volumes/Video &amp; Photos</string>
    <key>VolumeName</key><string>Video &amp; Photos</string>
    <key>ParentWholeDisk</key><string>disk9</string><key>Ejectable</key><true/>
    </dict></plist>`,
  );
  expect(source).toMatchObject({
    label: 'Video & Photos',
    volume: 'volume-one',
    disk: 'disk9',
    removable: true,
  });
  expect(source?.id).not.toContain('Video');
  expect(parseMountedMedia('/Volumes/Video & Photos', '<key>Internal</key><true/>')).toBeNull();
});

function volume(path: string, uuid: string, parent: string, stores: string[] = []) {
  return `<plist><dict>
    <key>Internal</key><false/><key>VolumeUUID</key><string>${uuid}</string>
    <key>MountPoint</key><string>${path}</string><key>ParentWholeDisk</key><string>${parent}</string>
    ${
      stores.length
        ? `<key>APFSContainerReference</key><string>${parent}</string>
      <key>APFSPhysicalStores</key><array>${stores
        .map((store) => `<dict><key>APFSPhysicalStore</key><string>${store}</string></dict>`)
        .join('')}</array>`
        : ''
    }
  </dict></plist>`;
}

it('guards physical siblings across APFS containers and every store of a Fusion volume', async () => {
  const values: Record<string, string> = {
    '/Volumes/Card': volume('/Volumes/Card', 'exfat', 'disk9'),
    '/Volumes/Other': volume('/Volumes/Other', 'other', 'disk10'),
    '/Volumes/Fusion': volume('/Volumes/Fusion', 'fusion', 'disk20', ['disk9s2', 'disk10s2']),
    '/Volumes/APFS': volume('/Volumes/APFS', 'apfs', 'disk21', ['disk9s3']),
    '/Volumes/Unrelated': volume('/Volumes/Unrelated', 'unrelated', 'disk11'),
    disk9s2: '<key>ParentWholeDisk</key><string>disk9</string>',
    disk9s3: '<key>ParentWholeDisk</key><string>disk9</string>',
    disk10s2: '<key>ParentWholeDisk</key><string>disk10</string>',
  };
  const port = createMacMountedMediaPort({
    paths: async () => Object.keys(values).filter((path) => path.startsWith('/Volumes/')),
    describe: async (target) => values[target]!,
  });
  const media = unwrap(await port.list());
  expect(media.find((source) => source.volume === 'apfs')?.physicalDisks).toEqual(['disk9']);
  expect(media.find((source) => source.volume === 'fusion')?.physicalDisks).toEqual(['disk9', 'disk10']);
  // Other precedes Fusion in the inventory, so discovering a second physical store needs another pass.
  expect(mountedEjectVolumes(media[0]!, media).sort()).toEqual(['apfs', 'exfat', 'fusion', 'other']);
});

it.each(['unreadable-volume', 'unreadable-store', 'missing-stores', 'invalid-parent'])(
  'refuses incomplete eject inventories (%s)',
  async (failure) => {
    const port = createMacMountedMediaPort({
      paths: async () => ['/Volumes/Card', '/Volumes/APFS'],
      async describe(target) {
        if (target === '/Volumes/Card') return volume(target, 'card', 'disk9');
        if (target === '/Volumes/APFS') {
          if (failure === 'unreadable-volume') throw new Error('unavailable volume');
          if (failure === 'missing-stores')
            return volume(target, 'apfs', 'disk20') + '<key>FilesystemType</key><string>apfs</string>';
          return volume(target, 'apfs', 'disk20', ['disk9s2']);
        }
        if (failure === 'unreadable-store') throw new Error('unavailable store');
        return '<key>DeviceIdentifier</key><string>disk9s2</string>';
      },
    });
    expect((await port.list()).ok).toBe(false);
  },
);
