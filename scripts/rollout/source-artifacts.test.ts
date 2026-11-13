// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { publishRelease } from './publish.ts';
import { dirReleaseStore } from './release-store.ts';
import {
  SOURCE_METADATA,
  assertSourceBuild,
  readSourceDistribution,
  sourceArtifacts,
} from './source-artifacts.ts';

let root: string;
const name = 'ffmpeg-9.0.2-source-aaaaaaaaaaaaaaaa.tar.zst';
const bytes = Buffer.from('corresponding source fixture');
const metadata = {
  url: `https://components.taalcut.app/ffmpeg/9.0.2/source/${name}`,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'taalcut-source-test-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixture(change = {}) {
  writeFileSync(join(root, SOURCE_METADATA), JSON.stringify({ ...metadata, ...change }));
  writeFileSync(join(root, name), bytes);
}

it('allows an isolated test feed without source but requires it for production', () => {
  expect(sourceArtifacts(root)).toEqual([]);
  expect(() => sourceArtifacts(root, true)).toThrow(/missing ffmpeg-source-distribution/);
});

it('accepts exact bytes and rejects tampered or truncated source before publication', () => {
  fixture();
  expect(sourceArtifacts(root, true)).toEqual([join(root, SOURCE_METADATA), join(root, name)]);
  writeFileSync(join(root, name), 'wrong');
  expect(() => sourceArtifacts(root, true)).toThrow(/checksum mismatch/);
});

it('rejects symlink archives and non-source destinations', () => {
  fixture();
  rmSync(join(root, name));
  symlinkSync(join(root, SOURCE_METADATA), join(root, name));
  expect(() => sourceArtifacts(root, true)).toThrow(/unsafe/);
  rmSync(join(root, name));
  for (const url of [
    'https://evil.example/source.tar.zst',
    'file:///etc/passwd',
    `${metadata.url}?other=1`,
  ]) {
    fixture({ url });
    expect(() => readSourceDistribution(join(root, SOURCE_METADATA))).toThrow(/unsafe/);
  }
});

it('refuses a public release without source before contacting the release store', async () => {
  const store = dirReleaseStore(join(root, 'published'));
  const read = vi.spyOn(store, 'release');
  await expect(
    publishRelease(store, {
      channel: 'beta',
      version: '1.2.0-beta.3',
      artifacts: root,
      notes: root,
      requireSource: true,
      stage: 100,
      downloadBase: 'https://github.com/owner/repo/releases/download',
      repoUrl: 'https://github.com/owner/repo',
      now: () => new Date(),
    }),
  ).rejects.toThrow(/missing ffmpeg-source/);
  expect(read).not.toHaveBeenCalled();
});

it('publishes source beside the binaries and includes both provenance and archive in SHA256SUMS', async () => {
  fixture();
  const version = '1.2.0-beta.3';
  for (const suffix of ['-mac.zip', '.dmg'])
    writeFileSync(join(root, `Taalcut-${version}-arm64${suffix}`), 'app');
  const notes = join(root, 'notes');
  mkdirSync(notes);
  writeFileSync(join(notes, 'en.md'), '- Beta');
  const published = join(root, 'published');
  const store = dirReleaseStore(published);
  await publishRelease(store, {
    channel: 'beta',
    version,
    artifacts: root,
    notes,
    requireSource: true,
    stage: 100,
    downloadBase: 'https://github.com/owner/repo/releases/download',
    repoUrl: 'https://github.com/owner/repo',
    now: () => new Date(),
  });
  expect((await store.release(`v${version}`))?.assets).toEqual(
    expect.arrayContaining([name, SOURCE_METADATA]),
  );
  const sums = readFileSync(join(published, `v${version}`, 'SHA256SUMS'), 'utf8');
  expect(sums).toContain(`${metadata.sha256}  ${name}`);
  expect(sums).toContain(`  ${SOURCE_METADATA}`);
});

it('refuses stale corresponding-source provenance after the binary build record changes', () => {
  const info = join(root, 'BUILDINFO.json');
  writeFileSync(info, 'first build');
  fixture({
    platforms: [
      { platform: 'darwin-arm64', buildinfoSha256: createHash('sha256').update('first build').digest('hex') },
    ],
  });
  expect(() => assertSourceBuild(join(root, SOURCE_METADATA), info, 'darwin-arm64')).not.toThrow();
  expect(() => assertSourceBuild(join(root, SOURCE_METADATA), info, 'linux-x64')).toThrow(/does not match/);
  writeFileSync(info, 'new binary build');
  expect(() => assertSourceBuild(join(root, SOURCE_METADATA), info, 'darwin-arm64')).toThrow(
    /does not match/,
  );
});
