// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks the signatures of a packaged Taalcut.app and its DMG.
 *
 *   node scripts/verify-signature.mjs [--notarized] [--built-app] [Taalcut.app | Taalcut-….dmg]…
 *
 * Without paths: what the last package made (packaging/build-output.ts), in the output directory of the flavour
 * out/build-info.json records (release/, release/test/, or TAALCUT_PACKAGE_OUTPUT): <output>/mac-arm64/Taalcut.app
 * and <output>/*.dmg, or with --built-app the app alone (package:dir).
 *
 * App:  codesign --verify --deep --strict; every Mach-O inside (helpers,
 *       frameworks, sqlite-vec, sidecars) signed with hardened runtime by the
 *       app's team, with a secure timestamp (Developer ID); spctl -a -t exec
 *       (Gatekeeper); stapler validate.
 * DMG:  codesign --verify --strict (signed, timestamped); spctl -a -t open
 *       --context context:primary-signature; stapler validate.
 *
 * Fails on any codesign problem. Gatekeeper rejects a Developer ID build
 * until it is notarised ("Unnotarized Developer ID"), so its verdict only
 * fails the check with --notarized, which also wants the stapled ticket and
 * spctl's "source=Notarized Developer ID" (the release gate, docs/release.md).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedArtifacts } from '../packaging/build-output.ts';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const requireNotarized = args.includes('--notarized');
let paths = args.filter((arg) => !arg.startsWith('--'));
if (paths.length === 0) {
  paths = packagedArtifacts(desktopDir, process.env, { appOnly: args.includes('--built-app') });
}
if (paths.length === 0) {
  console.error(
    'verify-signature: nothing to check; build with pnpm --filter @taalcut/desktop package first',
  );
  process.exit(1);
}

const problems = [];
const print = (line) => process.stdout.write(`${line}\n`);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** codesign -dvv, which reports on stderr. */
function signatureOf(file) {
  const { output } = run('codesign', ['-dvv', file]);
  const field = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(output)?.[1];
  return {
    adhoc: /^Signature=adhoc$/m.test(output),
    authorities: [...output.matchAll(/^Authority=(.*)$/gm)].map((match) => match[1]),
    team: field('TeamIdentifier'),
    timestamp: field('Timestamp'),
    runtime: /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(output),
  };
}

function isMachO(file) {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    if (readSync(fd, header, 0, 4, 0) < 4) return false;
    return [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xfeedface, 0xcefaedfe].includes(
      header.readUInt32BE(0),
    );
  } finally {
    closeSync(fd);
  }
}

function machOFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isDirectory()) return machOFiles(path);
    return stat.isFile() && isMachO(path) ? [path] : [];
  });
}

const NOTARIZED_SOURCE = 'Notarized Developer ID';

function gatekeeper(label, spctlArgs, path, developerId) {
  const verdict = run('spctl', [...spctlArgs, path]);
  const source = /source=(.*)$/m.exec(verdict.output)?.[1] ?? verdict.output.split('\n')[0];
  const accepted = verdict.status === 0;
  print(`  ${label}: ${accepted ? 'accepted' : 'rejected'} (${source})`);
  if (!accepted && requireNotarized) problems.push(`${path}: Gatekeeper rejected it (${source})`);
  // The release gate: accepted *because* Apple notarised it, not as a plain Developer ID.
  if (accepted && requireNotarized && source !== NOTARIZED_SOURCE) {
    problems.push(`${path}: Gatekeeper source is "${source}", want "${NOTARIZED_SOURCE}"`);
  }
  if (!accepted && !requireNotarized && developerId) print('    expected until notarised');
  const stapled = run('xcrun', ['stapler', 'validate', path]).status === 0;
  print(`  stapled ticket: ${stapled ? 'yes' : 'no'}`);
  if (!stapled && requireNotarized) problems.push(`${path}: no stapled notarisation ticket`);
}

function verifyApp(app) {
  print(`\n${relative(desktopDir, app) || app}`);
  const deep = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  print(`  codesign --verify --deep --strict: ${deep.status === 0 ? 'ok' : 'FAILED'}`);
  // Skip the per-component --prepared/--validated lines; keep the verdicts.
  for (const line of deep.output.split('\n').filter((l) => !/^--(prepared|validated):/.test(l))) {
    print(`    ${line.replace(`${app}: `, '')}`);
  }
  if (deep.status !== 0) problems.push(`${app}: codesign --verify --deep --strict failed`);

  const signature = signatureOf(app);
  const developerId = !signature.adhoc;
  print(
    developerId
      ? `  signed by ${signature.authorities.join(' < ')}; team ${signature.team}; timestamp ${signature.timestamp ?? 'none'}`
      : '  signed ad-hoc',
  );

  const binaries = machOFiles(join(app, 'Contents'));
  const bad = [];
  for (const file of binaries) {
    const nested = signatureOf(file);
    const name = relative(app, file);
    if (run('codesign', ['--verify', '--strict', file]).status !== 0) bad.push(`${name}: signature invalid`);
    if (!nested.runtime) bad.push(`${name}: no hardened runtime`);
    if (developerId && nested.team !== signature.team) bad.push(`${name}: team ${nested.team ?? 'none'}`);
    if (developerId && !nested.timestamp) bad.push(`${name}: no secure timestamp`);
  }
  print(
    `  ${binaries.length} Mach-O files inside: ${bad.length === 0 ? 'all signed, hardened runtime' : 'PROBLEMS'}`,
  );
  for (const line of bad) print(`    ${line}`);
  problems.push(...bad.map((line) => `${app}: ${line}`));

  gatekeeper('spctl -a -t exec', ['-a', '-vv', '-t', 'exec'], app, developerId);
}

function verifyDmg(dmg) {
  print(`\n${relative(desktopDir, dmg) || dmg}`);
  const verify = run('codesign', ['--verify', '--strict', '--verbose=2', dmg]);
  const signature = signatureOf(dmg);
  if (/not signed at all/.test(verify.output) && !process.env.TAALCUT_MAC_IDENTITY?.trim()) {
    print('  unsigned (ad-hoc builds leave the DMG unsigned)');
    return;
  }
  if (verify.status !== 0) {
    print(`  codesign --verify --strict: FAILED (${verify.output.split('\n').at(-1)})`);
    problems.push(`${dmg}: not validly signed`);
    return;
  }
  const developerId = !signature.adhoc;
  print(
    `  codesign --verify --strict: ok; ${signature.authorities[0] ?? 'ad-hoc'}; timestamp ${signature.timestamp ?? 'none'}`,
  );
  if (developerId && !signature.timestamp) problems.push(`${dmg}: no secure timestamp`);
  gatekeeper(
    'spctl -a -t open --context context:primary-signature',
    ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature'],
    dmg,
    developerId,
  );
}

for (const path of paths) {
  if (!existsSync(path)) problems.push(`${path}: not found`);
  else if (path.endsWith('.dmg')) verifyDmg(path);
  else verifyApp(path);
}

if (problems.length > 0) {
  console.error(
    `\nverify-signature: ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`,
  );
  process.exit(1);
}
print('\nverify-signature: ok');
