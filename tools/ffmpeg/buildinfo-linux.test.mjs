// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The linux-x64 build (build-linux.sh) and the BUILDINFO.json buildinfo.py writes for it: the pins in versions.env
 * are pinned (a base image by digest, a dated apt snapshot, https URLs with sha256s), the reproducibility record
 * survives a build of the bytes it describes and is left out otherwise, the committed BUILDINFO.json is an
 * LGPL-2.1-or-later build of these pins, and, with the build in dist/linux-x64, its files are the committed bytes.
 *
 *   node --test tools/ffmpeg/buildinfo-linux.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FFMPEG = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(FFMPEG, 'buildinfo.py');
const DIST = join(FFMPEG, 'dist', 'linux-x64');
const LIBRARIES = [
  'libavcodec.so.63',
  'libavdevice.so.63',
  'libavfilter.so.12',
  'libavformat.so.63',
  'libavutil.so.61',
  'libswresample.so.7',
  'libswscale.so.10',
];
const OUTPUTS = ['bin/ffmpeg', 'bin/ffprobe', ...LIBRARIES.map((name) => `lib/${name}`)];
const SOURCES = [
  'dav1d',
  'fast_float',
  'ffmpeg',
  'glslang',
  'jinja2',
  'lcms2',
  'libplacebo',
  'markupsafe',
  'nv-codec-headers',
  'openh264',
  'spirv-headers',
  'svt-av1',
  'vulkan-headers',
  'vulkan-loader',
  'zimg',
  'zlib',
];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const key = (name) => name.toUpperCase().replaceAll('-', '_');

/** versions.env's KEY=VALUE lines, quotes stripped, as buildinfo.py reads them. */
function readVersions() {
  const values = {};
  for (const raw of readFileSync(join(FFMPEG, 'versions.env'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    values[line.slice(0, at)] = line.slice(at + 1).replace(/^"(.*)"$/, '$1');
  }
  return values;
}
const versions = readVersions();

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** A root as build-linux.sh leaves it before the BUILDINFO step: versions.env, the container's notes, the outputs. */
function buildRoot(contents) {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-buildinfo-linux-'));
  roots.push(root);
  copyFileSync(join(FFMPEG, 'versions.env'), join(root, 'versions.env'));
  const out = join(root, '.build', 'linux-x64', 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'configure-line.txt'), '--prefix=/taalcut-ffmpeg --disable-gpl\n');
  writeFileSync(join(out, 'toolchain.txt'), 'gcc 11.4.0\nnasm 2.15.05\n');
  writeFileSync(join(out, 'toolchain-packages.txt'), 'gcc=4:11.2.0-1ubuntu1\n');
  OUTPUTS.forEach((rel, index) => {
    mkdirSync(dirname(join(root, 'dist', 'linux-x64', rel)), { recursive: true });
    writeFileSync(join(root, 'dist', 'linux-x64', rel), contents[index]);
  });
  return root;
}

function write(root, previous) {
  const previousPath = join(root, '.build', 'linux-x64', 'BUILDINFO.previous.json');
  if (previous !== undefined) writeFileSync(previousPath, `${JSON.stringify(previous, null, 2)}\n`);
  const note = execFileSync('python3', ['-I', SCRIPT, '--target', 'linux-x64', root, previousPath], {
    encoding: 'utf8',
  });
  return { note, doc: JSON.parse(readFileSync(join(root, 'dist', 'linux-x64', 'BUILDINFO.json'), 'utf8')) };
}

const FAKE = OUTPUTS.map((rel) => `${rel} bytes`);
const recordFor = (contents) => ({
  matched: true,
  method: 'two clean builds compared',
  sha256: Object.fromEntries(OUTPUTS.map((rel, index) => [rel.split('/').pop(), sha256(contents[index])])),
});

test('the Linux pins are pinned: a base image by digest, a dated snapshot, https sources with sha256', () => {
  assert.match(versions.LINUX_BASE_IMAGE, /^ubuntu:22\.04@sha256:[0-9a-f]{64}$/);
  assert.match(versions.LINUX_APT_SNAPSHOT, /^\d{8}T\d{6}Z$/);
  for (const name of [...SOURCES, 'LINUX_CMAKE', 'LINUX_MESON']) {
    const prefix = name.startsWith('LINUX_') ? name : key(name);
    assert.match(versions[`${prefix}_URL`], /^https:\/\//, `${prefix}_URL`);
    assert.match(versions[`${prefix}_SHA256`], /^[0-9a-f]{64}$/, `${prefix}_SHA256`);
    assert.ok(versions[`${prefix}_VERSION`], `${prefix}_VERSION`);
  }
  // Video Codec SDK 13.0: driver 570 or newer. 13.1 would need 610, above Taalcut's 580.
  assert.match(versions.NV_CODEC_HEADERS_VERSION, /^13\.0\./);
});

test('the record survives a build of the bytes it describes, and the document has the Linux fields', () => {
  const root = buildRoot(FAKE);
  const { note, doc } = write(root, { reproducibility: recordFor(FAKE) });
  assert.deepEqual(doc.reproducibility, recordFor(FAKE));
  assert.match(note, /reproducibility record kept from the replaced BUILDINFO\.json/);
  assert.deepEqual(
    doc.outputs.map((output) => [output.name, output.path, output.sha256]),
    OUTPUTS.map((rel, index) => [rel.split('/').pop(), rel, sha256(FAKE[index])]),
  );
  assert.equal(doc.target, 'linux-x64');
  assert.equal(doc.license, 'LGPL-2.1-or-later');
  assert.equal(doc.glibc_min, '2.35');
  assert.deepEqual(
    doc.sources.map((source) => source.name),
    SOURCES,
  );
  assert.equal(doc.toolchain.base_image, versions.LINUX_BASE_IMAGE);
  assert.equal(doc.toolchain.gcc, '11.4.0');
  assert.equal(doc.toolchain.installed_packages_sha256, sha256('gcc=4:11.2.0-1ubuntu1\n'));
});

test('a build of other bytes leaves the record out and names the file', () => {
  const other = [...FAKE];
  other[2] = 'another libavcodec';
  const root = buildRoot(other);
  const { note, doc } = write(root, { reproducibility: recordFor(FAKE) });
  assert.equal('reproducibility' in doc, false);
  assert.match(note, /describes other bytes for lib\/libavcodec\.so\.63\b/);
});

test('the committed BUILDINFO.json is an LGPL-2.1-or-later build of these pins', () => {
  const info = JSON.parse(readFileSync(join(DIST, 'BUILDINFO.json'), 'utf8'));
  assert.equal(info.target, 'linux-x64');
  assert.equal(info.ffmpeg_version, versions.FFMPEG_VERSION);
  assert.equal(info.license, 'LGPL-2.1-or-later');
  assert.equal(info.gpl, false);
  assert.equal(info.nonfree, false);
  const flags = info.configure.split(/\s+/);
  for (const flag of ['--disable-gpl', '--disable-nonfree', '--disable-version3', '--disable-autodetect'])
    assert.ok(flags.includes(flag), flag);
  for (const flag of ['--enable-gpl', '--enable-nonfree', '--enable-version3', '--enable-cuda-nvcc'])
    assert.ok(!flags.includes(flag), flag);
  for (const source of info.sources) {
    assert.equal(source.sha256, versions[`${key(source.name)}_SHA256`], source.name);
    assert.equal(source.url, versions[`${key(source.name)}_URL`], source.name);
  }
  assert.deepEqual(
    info.outputs.map((output) => output.path),
    OUTPUTS,
  );
  // The record describes these outputs.
  for (const output of info.outputs)
    assert.equal(info.reproducibility.sha256[output.name], output.sha256, output.name);
  assert.equal(info.reproducibility.matched, true);
});

test(
  'the build in dist/linux-x64 is the committed one, file for file',
  {
    skip:
      !existsSync(join(DIST, 'bin', 'ffmpeg')) && 'no build in dist/linux-x64 (tools/ffmpeg/build-linux.sh)',
  },
  () => {
    const info = JSON.parse(readFileSync(join(DIST, 'BUILDINFO.json'), 'utf8'));
    for (const output of info.outputs)
      assert.equal(sha256(readFileSync(join(DIST, output.path))), output.sha256, output.path);
  },
);

test('LICENSES/linux-x64 holds exactly the texts its INDEX.txt names', () => {
  const folder = join(FFMPEG, 'LICENSES', 'linux-x64');
  const index = readFileSync(join(folder, 'INDEX.txt'), 'utf8');
  // Section A's lines end in their files: name | upstream | version | licence | files
  const sectionA = index.slice(index.indexOf('\n# A.'), index.indexOf('\n# B.'));
  const named = sectionA
    .split('\n')
    .filter((line) => line.split(' | ').length === 5)
    .flatMap((line) => line.split(' | ')[4].trim().split(/\s+/));
  const present = readdirSync(folder).filter((name) => name !== 'INDEX.txt');
  assert.deepEqual([...named].sort(), [...present].sort());
  // Nothing of BtbN's build is left: no GPL library's text.
  for (const name of present) assert.doesNotMatch(name, /fftw|chromaprint|zvbi|x26[45]/i, name);
});

test('build-linux.sh keeps the replaced BUILDINFO.json before it deletes it, and writes the new one with buildinfo.py', () => {
  const script = readFileSync(join(FFMPEG, 'build-linux.sh'), 'utf8');
  const kept = script.indexOf('cp "$DIST/BUILDINFO.json" "$BUILD/BUILDINFO.previous.json"');
  const deleted = script.indexOf('rm -rf "$DIST/bin" "$DIST/lib" "$DIST/LICENSE.txt" "$DIST/BUILDINFO.json"');
  assert.ok(kept > 0 && deleted > kept, 'the copy comes before the rm');
  assert.match(
    script,
    /^python3 "\$ROOT\/buildinfo\.py" --target linux-x64 "\$ROOT" "\$BUILD\/BUILDINFO\.previous\.json"$/m,
  );
  // The build runs offline, as this user, capped.
  assert.match(script, /--network none/);
  assert.match(script, /--user "\$\(id -u\):\$\(id -g\)"/);
});
