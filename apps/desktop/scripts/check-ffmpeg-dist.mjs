// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg sidecar gate of the release workflow (.github/workflows/release.yml).
 * The committed tools/ffmpeg/dist/BUILDINFO.json is the reference.
 *
 *   node scripts/check-ffmpeg-dist.mjs check <dist> [--buildinfo <file>]
 *     Hashes every output the committed BUILDINFO.json lists under <dist>
 *     (sha256 and size), refuses symlinks and any file it doesn't list (dist/
 *     is packaged and its Mach-O files get the Developer ID signature), and
 *     with --buildinfo also compares a fresh build's BUILDINFO.json outputs
 *     with the committed ones.
 *     Exits 1 on any difference.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMMITTED = join(repoRoot, 'tools', 'ffmpeg', 'dist', 'BUILDINFO.json');
const USAGE = 'usage: check-ffmpeg-dist.mjs check <dist> [--buildinfo <file>]';

const print = (line) => process.stdout.write(`${line}\n`);
function fail(message) {
  console.error(`check-ffmpeg-dist: ${message}`);
  process.exit(1);
}

function readOutputs(file) {
  const info = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(info.outputs) || info.outputs.length === 0) fail(`${file} lists no outputs`);
  return { outputs: info.outputs };
}

/** "dist/lib/libMoltenVK.dylib" → "lib/libMoltenVK.dylib", relative to the dist directory. */
const inDist = (output) => output.path.replace(/^dist\//, '');

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return lstatSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function check(dist, fresh) {
  const { outputs } = readOutputs(COMMITTED);
  const problems = [];
  print(`FFmpeg sidecars in ${dist} against ${relative(repoRoot, COMMITTED)}:`);
  for (const output of outputs) {
    const name = inDist(output);
    const file = join(dist, name);
    if (!existsSync(file) || !lstatSync(file).isFile()) {
      problems.push(`${name}: missing, or not a regular file`);
      continue;
    }
    const data = readFileSync(file);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const same = sha256 === output.sha256 && data.length === output.bytes;
    print(`  ${same ? 'ok      ' : 'MISMATCH'} ${name} ${sha256} ${data.length} bytes`);
    if (!same) {
      problems.push(
        `${name}: ${sha256} (${data.length} bytes), committed ${output.sha256} (${output.bytes} bytes)`,
      );
    }
  }
  const expected = new Set([...outputs.map(inDist), 'BUILDINFO.json']);
  for (const file of existsSync(dist) ? filesUnder(dist) : []) {
    const name = relative(dist, file);
    if (!expected.has(name)) problems.push(`${name}: unexpected, not in the BUILDINFO.json outputs`);
  }
  if (fresh) {
    const key = (output) => `${output.path} ${output.sha256} ${output.bytes}`;
    const want = outputs.map(key).sort();
    const got = readOutputs(fresh).outputs.map(key).sort();
    const same = want.length === got.length && want.every((line, i) => line === got[i]);
    print(`  ${same ? 'ok      ' : 'MISMATCH'} ${fresh} outputs`);
    if (!same) problems.push(`${fresh}: outputs differ from the committed BUILDINFO.json`);
  }
  if (problems.length > 0) {
    fail(`${problems.length} problem(s):\n${problems.map((line) => `  ${line}`).join('\n')}`);
  }
  print('check-ffmpeg-dist: ok, byte-identical to the committed build');
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'check' && rest[0] && !rest[0].startsWith('--')) {
  const at = rest.indexOf('--buildinfo');
  if (at >= 0 && !rest[at + 1]) fail(USAGE);
  check(rest[0], at >= 0 ? rest[at + 1] : undefined);
} else {
  fail(USAGE);
}
