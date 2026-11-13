// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { archiveInputs, readPins, verifySources } from './package-source.mjs';

const sha256 = 'a'.repeat(64);
const pins = { FOO_VERSION: '1.2.3', FOO_URL: 'https://example.org/foo.tar.gz', FOO_SHA256: sha256 };
const mac = 'fetch "$FOO_URL" "$SRC/foo-${FOO_VERSION}.tar.gz" "$FOO_SHA256"';
const linux = 'fetch "foo-${FOO_VERSION}.tar.gz" "$FOO_URL" "$FOO_SHA256"';

test('both build recipes produce one pinned input, without executing shell expressions', () => {
  assert.deepEqual(archiveInputs([mac, linux], pins), [
    { file: 'foo-1.2.3.tar.gz', url: pins.FOO_URL, sha256 },
  ]);
  assert.equal(readPins('VALUE="$(touch /tmp/should-not-run)"').VALUE, '$(touch /tmp/should-not-run)');
});

test('a changed source pin, malformed fetch, or unsafe archive path fails closed', () => {
  assert.throws(() => archiveInputs(['fetch "foo"'], pins), /unrecognised/);
  assert.throws(() => archiveInputs([mac], {}), /missing pin/);
  assert.throws(() => archiveInputs([mac], { ...pins, FOO_VERSION: '../bad' }), /invalid source pin/);
  assert.throws(
    () => archiveInputs([mac, linux.replace('$FOO_URL', 'https://other.org/source')], pins),
    /conflicting/,
  );
  assert.throws(
    () =>
      verifySources(archiveInputs([mac], pins), [
        { sources: [{ name: 'foo', version: '1.2.3', url: pins.FOO_URL, sha256: 'b'.repeat(64) }] },
      ]),
    /missing or changed/,
  );
});

test('archive inventory covers every recorded source and pinned build tool for both shipped platforms', async () => {
  const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');
  const inputs = archiveInputs(
    await Promise.all(['build.sh', 'build-linux.sh'].map(read)),
    readPins(await read('versions.env')),
  );
  const builds = await Promise.all(
    ['dist/BUILDINFO.json', 'dist/linux-x64/BUILDINFO.json'].map(async (name) =>
      JSON.parse(await read(name)),
    ),
  );
  verifySources(inputs, builds);
  assert.equal(inputs.length, 19);
  assert.ok(inputs.some((pin) => pin.file === 'ffmpeg-9.0.2.tar.xz'));
  assert.ok(inputs.some((pin) => pin.file.startsWith('libplacebo-')));
});
