// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { runNotice } from './run.mjs';

const REACT_BITS_COMMIT = 'e2eb04d89d5be5a633dba7b2d4adfd274e053767';
const PAGE_MASCOT_COMMIT = '76a44ed9180063bf4852b9dd724b656f4a828ac7';
const FLUID_REVISION = '503b4bd1bbf7220882de39fe8ae6716aae4132da';
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PROFILES = 'packages/tools/src/sandbox/profiles';

function writeFile(path, text) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** Enough of a tree for the vendored checks. No pnpm, no real repo. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-notice-run-'));
  writeFile(
    join(root, 'third_party/react-bits/LICENSE'),
    'MIT + Commons Clause License Condition v1.0\n\nCopyright (c) 2026 David Haz\n',
  );
  writeFile(
    join(root, 'third_party/react-bits/README.md'),
    `commit \`${REACT_BITS_COMMIT}\`. It is not redistributed as a standalone component kit.\n`,
  );
  writeFile(
    join(root, 'third_party/page-mascot/LICENSE'),
    'MIT License\n\nCopyright (c) 2026 Kamran Ahmed\n',
  );
  writeFile(
    join(root, 'third_party/page-mascot/README.md'),
    `commit \`${PAGE_MASCOT_COMMIT}\`. It is not an npm dependency.\n`,
  );
  writeFile(join(root, 'native/mac-helper/LICENSES/FluidAudio-Apache-2.0.txt'), 'Apache License 2.0\n');
  writeFile(join(root, 'native/mac-helper/Package.swift'), 'exact: "0.17.7"\n');
  writeFile(join(root, 'native/mac-helper/Package.resolved'), `"revision" : "${FLUID_REVISION}"\n`);
  // LIB1-PLACE: the GeoNames places the app ships, as the lock file pins them.
  writeFile(
    join(root, 'packages/library/data/places.lock.json'),
    JSON.stringify({ file: 'places-v1.bin.gz', licence: 'CC-BY-4.0', sourceDate: '2026-10-28', cities: 2 }),
  );
  writeFile(join(root, 'packages/library/data/places-v1.bin.gz'), '');
  writeFile(
    join(root, 'packages/library/data/GEONAMES-NOTICE.txt'),
    'Data from GeoNames (https://www.geonames.org), CC BY 4.0.\n',
  );
  // HFW1: HyperFrames' agent skill, the Designer's reference, as its lock pins it.
  writeFile(
    join(root, 'packages/render/src/workspace/docs/docs.lock.json'),
    JSON.stringify({
      repo: 'https://github.com/heygen-com/hyperframes',
      tag: 'v0.8.209',
      commit: '0'.repeat(40),
      licence: 'Apache-2.0',
      files: ['skills/hyperframes/SKILL.md'],
    }),
  );
  writeFile(
    join(root, 'packages/render/src/workspace/docs/LICENSE'),
    'Apache License\nVersion 2.0, January 2004\n',
  );
  // AGT2 sbx: the workspace shell's profile and Codex's licence, as the checkout has them (the block checks a hash).
  for (const file of ['workspace.sb', 'LICENSES/Codex-Apache-2.0.txt'])
    writeFile(join(root, PROFILES, file), readFileSync(join(REPO, PROFILES, file), 'utf8'));
  writeFile(
    join(root, 'tools/components/manifest.one.json'),
    JSON.stringify({
      components: [
        {
          id: 'demo',
          name: 'Demo',
          version: '1.0.0',
          kind: 'runtime',
          licence: {
            spdx: 'MIT',
            notice: { url: 'https://example.invalid/demo', size: 1, sha256: '0'.repeat(64) },
            attribution: 'Demo credit',
          },
        },
      ],
    }),
  );
  return root;
}

const report = {
  MIT: [
    { name: 'left-pad', versions: ['1.0.0'], license: 'MIT', homepage: 'https://example.invalid/left-pad' },
  ],
};

describe('--check', () => {
  test('fails on a stale file and does not write', () => {
    const root = fixtureRoot();
    try {
      const noticePath = join(root, 'NOTICE');
      writeFileSync(noticePath, 'STALE-MARKER\n');
      const before = statSync(noticePath);
      const result = runNotice({ report, root, noticePath, check: true });
      assert.equal(result.code, 1);
      assert.ok(result.differed.includes('Header'));
      assert.equal(readFileSync(noticePath, 'utf8'), 'STALE-MARKER\n');
      const after = statSync(noticePath);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(after.size, before.size);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a rejected licence fails and does not write', () => {
    const root = fixtureRoot();
    try {
      const noticePath = join(root, 'NOTICE');
      writeFileSync(noticePath, 'KEEP\n');
      const rejected = {
        'GPL-3.0': [
          { name: 'bad', versions: ['1.2.3'], license: 'GPL-3.0', homepage: 'https://example.invalid/bad' },
        ],
      };
      const result = runNotice({ report: rejected, root, noticePath, check: true });
      assert.equal(result.code, 1);
      assert.equal(result.failures.length, 1);
      assert.equal(readFileSync(noticePath, 'utf8'), 'KEEP\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a committed rejection list is not a stale file', () => {
    const root = fixtureRoot();
    try {
      const noticePath = join(root, 'NOTICE');
      const rejected = {
        'GPL-3.0': [
          { name: 'bad', versions: ['1.2.3'], license: 'GPL-3.0', homepage: 'https://example.invalid/bad' },
        ],
      };
      const wrote = runNotice({ report: rejected, root, noticePath, check: false });
      assert.equal(wrote.code, 1);
      assert.match(readFileSync(noticePath, 'utf8'), /Not on the allowlist/);
      const again = runNotice({ report: rejected, root, noticePath, check: true });
      assert.equal(again.code, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('on a Mac and on Linux (LNX1-PKG)', () => {
  // Each machine lists only the optional binary it installs; the lockfile says which runs where.
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    "  '@esbuild/darwin-arm64@0.25.12':",
    '    cpu: [arm64]',
    '    os: [darwin]',
    '',
    "  '@esbuild/linux-x64@0.25.12':",
    '    cpu: [x64]',
    '    os: [linux]',
    '',
    '  fsevents@2.3.3:',
    '    os: [darwin]',
    '',
    '  left-pad@1.0.0:',
    '    resolution: {integrity: sha512-x}',
    '',
  ].join('\n');
  const esbuild = (platform) => ({
    name: `@esbuild/${platform}`,
    versions: ['0.25.12'],
    license: 'MIT',
    homepage: 'https://github.com/evanw/esbuild#readme',
  });
  const mac = {
    MIT: [...report.MIT, esbuild('darwin-arm64'), { name: 'fsevents', versions: ['2.3.3'], license: 'MIT' }],
  };
  const linux = { MIT: [...report.MIT, esbuild('linux-x64')] };
  const MAC = { os: 'darwin', cpu: 'arm64' };
  const LINUX = { os: 'linux', cpu: 'x64', libc: 'glibc' };

  test('write the same NOTICE, each keeping the rows of the binaries only the other installs', () => {
    const root = fixtureRoot();
    try {
      const noticePath = join(root, 'NOTICE');
      const run = (machine, host, check) =>
        runNotice({ report: machine, root, noticePath, check, lockfile, host });
      run(mac, MAC, false);
      const fromMac = readFileSync(noticePath, 'utf8');
      assert.doesNotMatch(fromMac, /linux-x64/);
      // Linux adds its binary and keeps the Mac's, which it can't read.
      run(linux, LINUX, false);
      const union = readFileSync(noticePath, 'utf8');
      for (const name of ['@esbuild/darwin-arm64', '@esbuild/linux-x64', 'fsevents', 'left-pad'])
        assert.match(union, new RegExp(`^${name} `, 'm'), name);
      assert.equal(run(linux, LINUX, true).code, 0);
      assert.equal(run(mac, MAC, true).code, 0);
      run(mac, MAC, false);
      assert.equal(readFileSync(noticePath, 'utf8'), union);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('drop a carried row once the lockfile no longer has that version, and never carry an installable one', () => {
    const root = fixtureRoot();
    try {
      const noticePath = join(root, 'NOTICE');
      runNotice({ report: mac, root, noticePath, check: false, lockfile, host: MAC });
      const bumped = lockfile.replace("'@esbuild/darwin-arm64@0.25.12'", "'@esbuild/darwin-arm64@0.25.13'");
      const result = runNotice({
        report: linux,
        root,
        noticePath,
        check: true,
        lockfile: bumped,
        host: LINUX,
      });
      assert.equal(result.code, 1);
      assert.deepEqual(result.differed, ['Third-party packages']);
      assert.doesNotMatch(result.text, /darwin-arm64/);
      assert.match(result.text, /^fsevents /m);
      // left-pad runs anywhere: a machine that no longer lists it drops it.
      const gone = runNotice({
        report: { MIT: [esbuild('linux-x64')] },
        root,
        noticePath,
        check: true,
        lockfile,
        host: LINUX,
      });
      assert.doesNotMatch(gone.text, /left-pad/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
