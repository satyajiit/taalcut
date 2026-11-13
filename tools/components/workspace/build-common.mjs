// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the workspace toolchain's pack scripts share: running a program, the one folder an archive holds, and the
 * end of every build (sign, check the signing policy, pack the recipe's tar.zst, describe it).
 */
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { packTarZst } from '../hosting/archive.mjs';
import { machOFiles, signTree, TAALCUT_TEAM, treeProblems } from '../hosting/codesign.mjs';
import { listEntries, sha256File } from '../hosting/files.mjs';

const exec = promisify(execFile);

export async function run(log, command, args, options = {}) {
  log(`$ ${basename(command)} ${args.join(' ')}`);
  const { stdout } = await exec(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  return stdout;
}

/** The single folder `dir` holds (an archive's top level). */
export async function onlyDir(dir) {
  const names = (await readdir(dir)).filter((name) => !name.startsWith('.'));
  if (names.length !== 1) throw new Error(`${dir}: expected one folder, found ${names.join(', ')}`);
  return join(dir, names[0]);
}

/**
 * Signs the tree's Mach-O files with `identity` (a release; none: a development build keeps the linker's ad hoc
 * signatures), checks them against `team` when one is required, packs `root` as `out`, and describes the file.
 * `team` set and no identity: upstream's own signatures (Node's) are checked as they are.
 */
export async function finish({ root, out, identity, team, platform, log }) {
  const entries = await listEntries(root);
  const machO = await machOFiles(root, entries);
  let signedBy = 'ad hoc (development build)';
  if (platform.startsWith('darwin')) {
    if (identity && !team) {
      await signTree(root, entries, { identity });
      const policy = await treeProblems(root, entries, TAALCUT_TEAM, { entitlements: {} });
      if (policy.problems.length > 0) throw new Error(`signatures:\n  ${policy.problems.join('\n  ')}`);
      signedBy = TAALCUT_TEAM;
    } else if (team) {
      const policy = await treeProblems(root, entries, team, {});
      if (policy.problems.length > 0) throw new Error(`signatures:\n  ${policy.problems.join('\n  ')}`);
      signedBy = team;
    }
  }
  log(`${machO.length} Mach-O file(s), signed by ${signedBy}`);
  const extractedSize = await packTarZst({ root, out, layout: 'stream', entries });
  return {
    archive: out,
    size: (await stat(out)).size,
    sha256: await sha256File(out),
    extractedSize,
    machO: machO.length,
    signedBy,
  };
}
