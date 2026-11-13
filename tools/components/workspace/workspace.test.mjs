// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's toolchain components (AGT2 sbx), without downloading anything: which npm packages the CLI
 * installs, the licence review, the shims and inventories, and that pins, plan, manifest and the shell's own
 * component ids agree.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { WORKSPACE } from '../hosting/plan/workspace.mjs';
import { cliInventory, isLicenceFile, shim } from './pack-cli.mjs';
import { integrityMatches, licenceAllowed, lockedPackages, selectPackages } from './cli-lock.mjs';
import { pythonInventory, unreviewedLibraries, wheelFile } from './pack-python.mjs';
import { archiveSections } from './dev-release.mjs';
import { HYPERFRAMES_CLI, VERSIONS, WHEELS } from './pins.mjs';
import { portDrawElement } from './patch-cli-engine.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = join(HERE, '..', '..', '..');
const lock = JSON.parse(readFileSync(join(HERE, HYPERFRAMES_CLI.lock), 'utf8'));
const manifest = JSON.parse(
  readFileSync(join(REPO, 'tools/components/manifest.workspace.provisional.json'), 'utf8'),
);

describe('the CLI packages', () => {
  test('refuses to patch an unknown bundled engine before changing it', () => {
    assert.throws(() => portDrawElement('unreviewed upstream bytes', '', ''), /Unexpected CLI engine bundle/);
  });
  const npmLock = {
    packages: {
      '': { dependencies: { hyperframes: '0.8.209' } },
      'node_modules/hyperframes': { version: '0.8.209', license: 'Apache-2.0' },
      'node_modules/esbuild': { version: '0.28.2', license: 'MIT' },
      'node_modules/@esbuild/darwin-arm64': {
        version: '0.28.2',
        optional: true,
        os: ['darwin'],
        cpu: ['arm64'],
      },
      'node_modules/@esbuild/linux-x64': { version: '0.28.2', optional: true, os: ['linux'], cpu: ['x64'] },
      'node_modules/sharp': { version: '0.35.0', optional: true },
      'node_modules/@img/sharp-libvips-darwin-arm64': { version: '1', optional: true, os: ['darwin'] },
      'node_modules/a/node_modules/b': { version: '1.0.0', license: 'ISC' },
      'node_modules/typescript': { version: '5', dev: true },
    },
  };

  test("keep what isn't optional, and only esbuild's own executable for the platform", () => {
    assert.deepEqual(
      selectPackages(npmLock, 'darwin-arm64').map((p) => `${p.path} ${p.name}`),
      [
        'node_modules/@esbuild/darwin-arm64 @esbuild/darwin-arm64',
        'node_modules/a/node_modules/b b',
        'node_modules/esbuild esbuild',
        'node_modules/hyperframes hyperframes',
      ],
    );
    assert.ok(selectPackages(npmLock, 'linux-x64').some((p) => p.name === '@esbuild/linux-x64'));
  });

  test('pass permissive licences, and an OR with one permissive side; fail copyleft', () => {
    assert.equal(licenceAllowed('MIT'), true);
    assert.equal(licenceAllowed('(MIT OR GPL-3.0-only)'), true);
    assert.equal(licenceAllowed('Apache-2.0 AND MIT'), true);
    assert.equal(licenceAllowed('Apache-2.0 AND LGPL-3.0-or-later'), false);
    assert.equal(licenceAllowed(undefined), false);
  });

  test("check a tarball against npm's sha512 integrity", () => {
    const bytes = Buffer.from('package');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    assert.equal(integrityMatches(integrity, bytes), true);
    assert.equal(integrityMatches(integrity, Buffer.from('other')), false);
    assert.equal(integrityMatches('sha1-abc', bytes), false);
  });

  test('the committed lock: hyperframes at its pin, no sharp, every licence allowed, each pinned by sha256', () => {
    assert.equal(lock.hyperframes, HYPERFRAMES_CLI.version);
    const mac = lockedPackages(lock, 'darwin-arm64');
    assert.ok(mac.some((p) => p.name === 'hyperframes' && p.version === HYPERFRAMES_CLI.version));
    assert.ok(mac.some((p) => p.name === '@esbuild/darwin-arm64'));
    assert.ok(!mac.some((p) => p.name === '@esbuild/linux-x64'));
    for (const pkg of lock.packages) {
      assert.ok(!/^(sharp|@img\/)/.test(pkg.name), pkg.name);
      assert.ok(licenceAllowed(pkg.license), `${pkg.name} ${pkg.license}`);
      assert.match(pkg.sha256, /^[0-9a-f]{64}$/);
      assert.ok(pkg.path.startsWith('node_modules/') && !pkg.path.includes('..'), pkg.path);
      assert.match(pkg.url, /^https:\/\/registry\.npmjs\.org\//);
    }
  });

  test('a shim runs the CLI on the Node first on PATH, and the inventory names every licence file', () => {
    const text = shim('bin/hyperframes.mjs');
    assert.match(text, /^#!\/bin\/sh\n/);
    assert.match(
      text,
      /exec node --require "\$here\/\.\.\/lib\/taalcut-loopback\.cjs" "\$here\/\.\.\/node_modules\/hyperframes\/bin\/hyperframes\.mjs" "\$@"/,
    );
    assert.equal(isLicenceFile('LICENSE'), true);
    assert.equal(isLicenceFile('LICENCE.md'), true);
    assert.equal(isLicenceFile('license-MIT'), true);
    assert.equal(isLicenceFile('licensed.js'), false);
    const inventory = cliInventory([
      { name: 'a', version: '1.0.0', path: 'node_modules/a', license: 'MIT', files: ['LICENSE'] },
      { name: 'b', version: '2.0.0', path: 'node_modules/b', license: 'ISC', files: [] },
    ]);
    assert.match(inventory, /a 1\.0\.0 \(node_modules\/a\): MIT; LICENSES\/a@1\.0\.0\/LICENSE/);
    assert.match(inventory, /b 2\.0\.0 \(node_modules\/b\): ISC; no licence file in the package/);
  });
});

describe('the Python', () => {
  test("a wheel library its review doesn't name fails the build", () => {
    const pillow = WHEELS['darwin-arm64'].find((wheel) => wheel.name === 'pillow');
    assert.deepEqual(
      unreviewedLibraries(
        ['PIL/.dylibs/libpng16.16.dylib', 'PIL/.dylibs/libx264.164.dylib', 'PIL/_imaging.so'],
        pillow,
      ),
      ['libx264'],
    );
  });

  test("the inventory credits CPython's libraries and each wheel; a wheel is named by its url", () => {
    const text = pythonInventory({ licences: ['MIT', 'Python-2.0'] }, WHEELS['darwin-arm64']);
    assert.match(text, /^CPython 3\.14\.9 .*: MIT AND Python-2\.0;/);
    assert.match(text, /numpy 2\.5\.4: BSD-3-Clause/);
    assert.match(text, /pillow 13\.0\.0: MIT-CMU .*; bundles libavif/);
    assert.equal(wheelFile(WHEELS['darwin-arm64'][0]), 'numpy-2.5.4-cp314-cp314-macosx_14_0_arm64.whl');
  });
});

describe('pins, plan and manifest', () => {
  test('agree on ids, versions and files, and match the ids the shell installs', () => {
    const ids = manifest.components.map((component) => component.id);
    assert.deepEqual(ids, Object.keys(WORKSPACE));
    for (const component of manifest.components) {
      assert.equal(component.version, VERSIONS[component.id]);
      assert.deepEqual(component.tiers, []);
      for (const artifact of component.artifacts)
        assert.equal(artifact.urls[0].split('/').pop(), WORKSPACE[component.id].file);
    }
    const toolchain = readFileSync(join(REPO, 'packages/tools/src/shell/toolchain.ts'), 'utf8');
    for (const id of ids) assert.match(toolchain, new RegExp(`componentId: '${id}'`));
    assert.deepEqual(manifest.components.find((c) => c.id === 'hyperframes-cli').dependencies, [
      'workspace-node',
    ]);
  });

  test("a development notice quotes the archive's licence files as the hosting build does", async () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-workspace-notice-'));
    try {
      mkdirSync(join(root, 'LICENSES', 'a'), { recursive: true });
      writeFileSync(join(root, 'LICENSE'), 'top');
      writeFileSync(join(root, 'LICENSES', 'a', 'LICENSE'), 'inner');
      const sections = await archiveSections(
        { inArtifact: [{ title: 'Top', path: 'LICENSE' }], inArtifactDir: 'LICENSES' },
        root,
      );
      assert.deepEqual(sections, [
        { title: 'Top', text: 'top' },
        { title: 'LICENSES/a/LICENSE (from the archive)', text: 'inner' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
