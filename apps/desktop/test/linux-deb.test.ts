// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEB_DEPENDS,
  DEB_REQUIRED_FILES,
  debProblems,
  INSTALL_DIR,
  parseControl,
  parseDebListing,
} from '../packaging/linux-deb';

const desktopDir = join(import.meta.dirname, '..');
const fill = (name: string) =>
  readFileSync(join(desktopDir, 'packaging', 'linux', name), 'utf8')
    .replaceAll('${executable}', 'taalcut')
    .replaceAll('${sanitizedProductName}', 'Taalcut');

const line = (mode: string, path: string, owner = 'root/root') =>
  `${mode} ${owner} 1024 2026-10-27 15:00 .${path}`;
const files = DEB_REQUIRED_FILES.map((file) => (file.startsWith('/') ? file : `${INSTALL_DIR}/${file}`));
const executables = new Set(
  ['taalcut', 'resources/ffmpeg/bin/ffmpeg', 'resources/ffmpeg/bin/ffprobe'].map(
    (f) => `${INSTALL_DIR}/${f}`,
  ),
);
const listing = files
  .map((path) => line(executables.has(path) ? '-rwxr-xr-x' : '-rw-r--r--', path))
  .join('\n');
const control = [
  'Package: taalcut',
  'Version: 0.0.0',
  'Architecture: amd64',
  `Depends: ${DEB_DEPENDS.join(', ')}`,
  'Description: Short-form videos',
  ' Taalcut turns your footage into short-form videos.',
].join('\n');
const good = { control, listing, postinst: fill('after-install.tpl'), postrm: fill('after-remove.tpl') };

describe('debProblems', () => {
  it('passes a package with everything LNX1-PKG ships', () => {
    expect(debProblems(good)).toEqual([]);
  });

  it('names a missing dependency, a missing file, a wrong owner and a macOS piece', () => {
    const problems = debProblems({
      ...good,
      control: control.replace(', libsecret-1-0', ''),
      listing: [
        ...listing.split('\n').filter((entry) => !entry.endsWith('/resources/ffmpeg/bin/ffprobe')),
        line('-rw-r--r--', `${INSTALL_DIR}/resources/bin/taalcut-mac-helper`),
        line('-rw-r--r--', `${INSTALL_DIR}/resources/extra`, 'builder/builder'),
      ].join('\n'),
    });
    expect(problems).toEqual([
      'Depends lacks libsecret-1-0',
      `${INSTALL_DIR}/resources/ffmpeg/bin/ffprobe is not in the package`,
      `${INSTALL_DIR}/resources/bin/taalcut-mac-helper is a macOS piece`,
      `${INSTALL_DIR}/resources/extra is owned by builder/builder, not root/root`,
    ]);
  });

  it("refuses electron-builder's own postinst, which leaves chrome-sandbox 0755 on Ubuntu 24.04", () => {
    const stock = [
      'if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then',
      "    chmod 4755 '/opt/Taalcut/chrome-sandbox' || true",
      'else',
      "    chmod 0755 '/opt/Taalcut/chrome-sandbox' || true",
      'fi',
    ].join('\n');
    expect(debProblems({ ...good, postinst: stock })).toEqual(
      expect.arrayContaining(["postinst doesn't make chrome-sandbox setuid root"]),
    );
    expect(debProblems({ ...good, postrm: 'rm -f /etc/apparmor.d/taalcut' })).toEqual([
      "postrm doesn't unload the AppArmor profile on remove and purge",
    ]);
  });
});

describe('dpkg-deb output', () => {
  it('reads the file list, links and directories included', () => {
    expect(
      parseDebListing(
        [
          'drwxr-xr-x root/root         0 2026-10-27 15:00 ./opt/Taalcut/',
          'lrwxrwxrwx root/root         0 2026-10-27 15:00 ./usr/bin/x -> /opt/Taalcut/taalcut',
          '-rw-r--r-- root/root      1024 2026-10-27 15:00 ./opt/Taalcut/a file',
        ].join('\n'),
      ),
    ).toEqual([
      { mode: 'drwxr-xr-x', owner: 'root/root', path: '/opt/Taalcut' },
      { mode: 'lrwxrwxrwx', owner: 'root/root', path: '/usr/bin/x' },
      { mode: '-rw-r--r--', owner: 'root/root', path: '/opt/Taalcut/a file' },
    ]);
  });

  it('reads control fields with their continuation lines', () => {
    expect(parseControl(control)).toMatchObject({
      Package: 'taalcut',
      Description: 'Short-form videos\nTaalcut turns your footage into short-form videos.',
    });
  });
});
