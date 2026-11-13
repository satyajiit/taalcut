// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { carriedRows, installableOn, lockfileConstraints } from './other-platforms.mjs';

const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: 1.0.0

packages:

  '@rolldown/binding-linux-x64-gnu@1.2.13':
    resolution: {integrity: sha512-x}
    engines: {node: ^20.19.0 || >=22.12.0}
    cpu: [x64]
    os: [linux]
    libc: [glibc]

  fsevents@2.3.3:
    os: [darwin]

  not-windows@1.0.0:
    os: ['!win32']

  left-pad@1.0.0:
    resolution: {integrity: sha512-y}

snapshots:

  fsevents@2.3.3:
    optional: true
`;

describe('lockfileConstraints', () => {
  test('reads os, cpu and libc from the packages section only', () => {
    const constraints = lockfileConstraints(LOCKFILE);
    assert.deepEqual(Object.fromEntries(constraints), {
      '@rolldown/binding-linux-x64-gnu@1.2.13': { cpu: ['x64'], os: ['linux'], libc: ['glibc'] },
      'fsevents@2.3.3': { os: ['darwin'] },
      'not-windows@1.0.0': { os: ['!win32'] },
    });
  });
});

describe('installableOn', () => {
  const linux = { os: 'linux', cpu: 'x64', libc: 'glibc' };
  const mac = { os: 'darwin', cpu: 'arm64' };
  test('follows pnpm: the host must be listed, a !name excludes it, libc counts on Linux only', () => {
    const constraints = lockfileConstraints(LOCKFILE);
    const rolldown = constraints.get('@rolldown/binding-linux-x64-gnu@1.2.13');
    assert.equal(installableOn(rolldown, linux), true);
    assert.equal(installableOn(rolldown, { ...linux, libc: 'musl' }), false);
    assert.equal(installableOn(rolldown, mac), false);
    assert.equal(installableOn(constraints.get('fsevents@2.3.3'), mac), true);
    assert.equal(installableOn(constraints.get('fsevents@2.3.3'), linux), false);
    assert.equal(installableOn(constraints.get('not-windows@1.0.0'), linux), true);
    assert.equal(installableOn(constraints.get('not-windows@1.0.0'), { os: 'win32', cpu: 'x64' }), false);
    assert.equal(installableOn(undefined, mac), true);
  });
});

describe('carriedRows', () => {
  const notice = [
    'Taalcut',
    '',
    'Third-party packages',
    '',
    'name                             version  licence  homepage',
    '-------------------------------  -------  -------  -----------------------------',
    '@rolldown/binding-linux-x64-gnu  1.2.13   MIT      https://rolldown.rs/',
    'fsevents                         2.3.3    MIT      https://github.com/fsevents/fsevents',
    'left-pad                         1.0.0    MIT      https://example.invalid/left-pad',
    'old-binary                       0.1.0    MIT      https://example.invalid/old',
    '',
    'Notes',
    'fsevents 2.3.3: macOS only.',
    '',
    'Components',
  ].join('\n');

  test('carries the rows of packages this machine cannot install, with their notes', () => {
    assert.deepEqual(carriedRows(notice, LOCKFILE, { os: 'darwin', cpu: 'arm64' }), [
      {
        name: '@rolldown/binding-linux-x64-gnu',
        version: '1.2.13',
        license: 'MIT',
        homepage: 'https://rolldown.rs/',
        ok: true,
        note: '',
      },
    ]);
    assert.deepEqual(
      carriedRows(notice, LOCKFILE, { os: 'linux', cpu: 'x64', libc: 'glibc' }).map((row) => [
        row.name,
        row.note,
      ]),
      [['fsevents', 'macOS only.']],
    );
  });

  test('carries nothing from an empty file, or what the lockfile no longer has', () => {
    assert.deepEqual(carriedRows('', LOCKFILE, { os: 'linux', cpu: 'x64', libc: 'glibc' }), []);
    assert.deepEqual(carriedRows(notice, '', { os: 'linux', cpu: 'x64', libc: 'glibc' }), []);
  });
});
