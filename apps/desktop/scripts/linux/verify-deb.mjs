// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks a built Taalcut .deb (LNX1-PKG) without installing it.
 *
 *   node scripts/linux/verify-deb.mjs [taalcut_<version>_amd64.deb]
 *
 * Without a path: the newest .deb in the output directory of the flavour out/build-info.json records
 * (packaging/build-output.ts). It reads the control file, the file list and the maintainer scripts with dpkg-deb
 * and checks them against packaging/linux-deb.ts (the dependencies, the files, root ownership, no macOS pieces,
 * chrome-sandbox made setuid root by the postinst, the AppArmor profile loaded by the postinst and unloaded by the
 * postrm), then parses the packaged AppArmor profile with apparmor_parser where AppArmor 4 is installed, and runs
 * lintian when it is there (its findings are printed, not failed on).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageOutput } from '../../packaging/build-output.ts';
import { debProblems, INSTALL_DIR } from '../../packaging/linux-deb.ts';

const say = (text) => process.stdout.write(`${text}\n`);
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function newestDeb() {
  const output = packageOutput(desktopDir, process.env);
  const debs = existsSync(output) ? readdirSync(output).filter((name) => name.endsWith('.deb')) : [];
  debs.sort((a, b) => statSync(join(output, b)).mtimeMs - statSync(join(output, a)).mtimeMs);
  return debs[0] ? join(output, debs[0]) : undefined;
}

const deb = process.argv[2] ?? newestDeb();
if (!deb) {
  console.error('verify-deb: no .deb found; build one with pnpm --filter @taalcut/desktop package:linux');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'taalcut-verify-deb-'));
try {
  run('dpkg-deb', ['--control', deb, join(scratch, 'control')]);
  const script = (name) => readFileSync(join(scratch, 'control', name), 'utf8');
  const problems = debProblems({
    control: run('dpkg-deb', ['--field', deb]),
    listing: run('dpkg-deb', ['--contents', deb]),
    postinst: script('postinst'),
    postrm: script('postrm'),
  });

  // The profile as the postinst will install it: parsed by this machine's AppArmor when it reads abi 4.0.
  const profile = `.${INSTALL_DIR}/resources/apparmor-profile`;
  const tree = join(scratch, 'tree');
  spawnSync('sh', [
    '-c',
    `mkdir -p "$2" && dpkg-deb --fsys-tarfile "$1" | tar -x -C "$2" "$3"`,
    'sh',
    deb,
    tree,
    profile,
  ]);
  if (existsSync('/etc/apparmor.d/abi/4.0') && spawnSync('apparmor_parser', ['--version']).status === 0) {
    const parsed = spawnSync(
      'apparmor_parser',
      ['--skip-kernel-load', '--skip-cache', '-N', join(tree, profile)],
      {
        encoding: 'utf8',
      },
    );
    if (parsed.status !== 0) problems.push(`apparmor_parser refuses the profile: ${parsed.stderr.trim()}`);
    else say(`AppArmor profiles: ${parsed.stdout.trim().split('\n').join(', ')}`);
  } else say('AppArmor 4 not here: the profile was not parsed');

  if (spawnSync('lintian', ['--version']).status === 0) {
    const lint = spawnSync('lintian', ['--no-tag-display-limit', deb], { encoding: 'utf8' });
    say(`lintian (informational):\n${(lint.stdout + lint.stderr).trim() || 'no findings'}`);
  }

  if (problems.length > 0) {
    console.error(`verify-deb: ${deb}\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  say(`verify-deb: ${deb} ok`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
