// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * buildinfo.py, which writes dist/BUILDINFO.json for build.sh: the reproducibility record survives a build whose
 * outputs are the bytes it describes (from the replaced file, or else the committed one), and is left out, with the
 * reason, when they are not. With this checkout's own FFmpeg build in dist/, rewriting from it gives the committed
 * file byte for byte, so a build that reproduces the binaries no longer changes BUILDINFO.json or its pinned sha256.
 *
 *   node --test tools/ffmpeg/buildinfo.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
const COMMITTED = join(FFMPEG, 'dist', 'BUILDINFO.json');
const OUTPUTS = ['dist/ffmpeg', 'dist/ffprobe', 'dist/lib/libMoltenVK.dylib', 'dist/lib/MoltenVK_icd.json'];
const RECORD_KEYS = ['ffmpeg_sha256', 'ffprobe_sha256', 'libMoltenVK_dylib_sha256', 'moltenvk_icd_sha256'];

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** A build root as build.sh leaves it before the BUILDINFO step: versions.env, the configure line, the outputs. */
function buildRoot(outputs, configure = '--prefix=/taalcut-ffmpeg --disable-gpl') {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-buildinfo-'));
  roots.push(root);
  copyFileSync(join(FFMPEG, 'versions.env'), join(root, 'versions.env'));
  mkdirSync(join(root, '.build'));
  writeFileSync(join(root, '.build', 'configure-line.txt'), `${configure}\n`);
  OUTPUTS.forEach((rel, index) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), outputs[index]);
  });
  return root;
}

const recordFor = (outputs) => ({
  matched: true,
  method: 'two clean builds compared',
  ...Object.fromEntries(RECORD_KEYS.map((key, index) => [key, sha256(outputs[index])])),
});

/** Runs buildinfo.py on the root with `previous` as the replaced BUILDINFO.json (none when undefined). */
function write(root, previous) {
  const previousPath = join(root, '.build', 'BUILDINFO.previous.json');
  if (previous !== undefined) writeFileSync(previousPath, `${JSON.stringify(previous, null, 2)}\n`);
  const note = execFileSync('python3', ['-I', SCRIPT, root, previousPath], { encoding: 'utf8' });
  return { note, text: readFileSync(join(root, 'dist', 'BUILDINFO.json'), 'utf8') };
}

const FAKE = ['ffmpeg bytes', 'ffprobe bytes', 'moltenvk bytes', '{"icd": true}'];

test('the record survives a build of the bytes it describes, verbatim', () => {
  const root = buildRoot(FAKE);
  const record = recordFor(FAKE);
  const { note, text } = write(root, { reproducibility: record });
  const doc = JSON.parse(text);
  assert.deepEqual(doc.reproducibility, record);
  assert.deepEqual(
    doc.outputs.map((output) => [output.path, output.sha256, output.bytes]),
    OUTPUTS.map((rel, index) => [rel, sha256(FAKE[index]), Buffer.byteLength(FAKE[index])]).sort(),
  );
  assert.match(note, /reproducibility record kept from the replaced BUILDINFO\.json/);
  // The form build.sh always wrote: sorted keys, two spaces, one trailing newline.
  assert.equal(text, `${JSON.stringify(sortKeys(doc), null, 2)}\n`);
});

test('a build of other bytes leaves the record out and names what differs', () => {
  const root = buildRoot(['ffmpeg bytes', 'a different ffprobe', 'moltenvk bytes', '{"icd": true}']);
  const { note, text } = write(root, { reproducibility: recordFor(FAKE) });
  assert.equal('reproducibility' in JSON.parse(text), false);
  assert.match(note, /describes other bytes for dist\/ffprobe\b/);
  assert.match(note, /Compare two clean builds/);
});

test('with no record in the replaced file, the committed record is carried when it matches', () => {
  const root = buildRoot(FAKE);
  const git = (...args) =>
    execFileSync(
      'git',
      ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
      },
    );
  git('init', '-q');
  writeFileSync(join(root, 'dist', 'BUILDINFO.json'), JSON.stringify({ reproducibility: recordFor(FAKE) }));
  git('add', 'dist/BUILDINFO.json');
  git('commit', '-q', '--no-verify', '-m', 'record');
  // An earlier build.sh rewrote the file without the record.
  const { note, text } = write(root, { outputs: [] });
  assert.deepEqual(JSON.parse(text).reproducibility, recordFor(FAKE));
  assert.match(note, /kept from the committed BUILDINFO\.json/);
});

test('outside a checkout and with no record to carry, it says so', () => {
  const root = buildRoot(FAKE);
  const { note, text } = write(root, undefined);
  assert.equal('reproducibility' in JSON.parse(text), false);
  assert.match(note, /no reproducibility record \(no committed BUILDINFO\.json: /);
});

test('this checkout’s FFmpeg build rewrites the committed BUILDINFO.json byte for byte', (t) => {
  const committedText = readFileSync(COMMITTED, 'utf8');
  const committed = JSON.parse(committedText);
  const real = OUTPUTS.map((rel) => join(FFMPEG, rel));
  if (!real.every((file) => existsSync(file))) {
    t.skip('no FFmpeg build in tools/ffmpeg/dist (run tools/ffmpeg/build.sh)');
    return;
  }
  const bytes = real.map((file) => readFileSync(file));
  const pinned = Object.fromEntries(committed.outputs.map((output) => [output.path, output.sha256]));
  if (OUTPUTS.some((rel, index) => sha256(bytes[index]) !== pinned[rel])) {
    t.skip('tools/ffmpeg/dist holds another build than the committed BUILDINFO.json describes');
    return;
  }
  const root = buildRoot(bytes, committed.configure);
  // The checkout's own file, as build.sh copies it aside before it builds.
  const { note, text } = write(root, committed);
  assert.equal(text, committedText);
  assert.match(note, committed.reproducibility ? /reproducibility record kept/ : /no reproducibility record/);
});

test('build.sh keeps the replaced BUILDINFO.json before it deletes it, and writes the new one with buildinfo.py', () => {
  const script = readFileSync(join(FFMPEG, 'build.sh'), 'utf8');
  const kept = script.indexOf('cp "$ROOT/dist/BUILDINFO.json" "$BUILD/BUILDINFO.previous.json"');
  const deleted = script.search(
    /^rm -f "\$ROOT\/dist\/ffmpeg" "\$ROOT\/dist\/ffprobe" "\$ROOT\/dist\/BUILDINFO\.json"/m,
  );
  assert.ok(kept > 0 && deleted > kept, 'the copy comes before the rm');
  assert.match(script, /^python3 "\$ROOT\/buildinfo\.py" "\$ROOT" "\$BUILD\/BUILDINFO\.previous\.json"$/m);
  // The inline writer it replaced (which dropped the record) is gone.
  assert.doesNotMatch(script, /root \/ "dist" \/ "BUILDINFO\.json"/);
});

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  return value;
}
