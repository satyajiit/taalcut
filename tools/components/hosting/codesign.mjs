// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Developer ID signing for component binaries (README.md, "Releasing components", step 2): every Mach-O, hardened
 * runtime, secure timestamp, then `codesign --verify --strict`. The policy check reads `codesign -dvv` back, so a
 * file that only verifies (ad-hoc, linker-signed, no timestamp) is still refused.
 */
import { execFile } from 'node:child_process';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CODESIGN = '/usr/bin/codesign';

/** Taalcut's signing identity and team (P1-B3). TAALCUT_MAC_IDENTITY names it for the pack scripts too. */
export const DEFAULT_IDENTITY = 'Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)';
export const TAALCUT_TEAM = 'WW382UC8JD';

const THIN = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);
const FAT = new Set([0xcafebabe, 0xcafebabf]);

/** Mach-O magic, thin or universal. A universal header also names a few slices (a Java class file names ~50+). */
export function isMachOHeader(bytes) {
  if (bytes.length < 8) return false;
  const magic = bytes.readUInt32BE(0);
  if (THIN.has(magic)) return true;
  if (!FAT.has(magic) && bytes.readUInt32LE(0) !== 0xcafebabe) return false;
  const slices = FAT.has(magic) ? bytes.readUInt32BE(4) : bytes.readUInt32LE(4);
  return slices > 0 && slices < 16;
}

export async function isMachO(path) {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(8), 0, 8, 0);
    return isMachOHeader(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** The regular files among `entries` (relative to `root`) that are Mach-O; symlinks are skipped. */
export async function machOFiles(root, entries) {
  const found = [];
  for (const path of entries) {
    const full = join(root, path);
    if ((await lstat(full)).isFile() && (await isMachO(full))) found.push(path);
  }
  return found;
}

/** Libraries before the programs that load them (inside-out), each group in name order. */
export function signingOrder(paths) {
  const library = (path) => /\.(dylib|so|node)$/.test(path);
  return [...paths.filter(library), ...paths.filter((path) => !library(path))];
}

/** Signs `file` with the Developer ID, hardened runtime and a secure timestamp, then verifies it strictly. */
export async function signFile(file, { identity = DEFAULT_IDENTITY, entitlements } = {}) {
  const args = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity];
  if (entitlements) args.push('--entitlements', entitlements);
  await exec(CODESIGN, [...args, file]);
  await exec(CODESIGN, ['--verify', '--strict', file]);
}

/** Signs every Mach-O among `entries` (paths relative to `root`); `entitlements` maps a path to a plist. */
export async function signTree(root, entries, { identity, entitlements = {} } = {}) {
  const machO = await machOFiles(root, entries);
  for (const path of signingOrder(machO))
    await signFile(join(root, path), { identity, entitlements: entitlements[path] });
  return machO;
}

/** The fields of `codesign -dvv` output the policy needs. */
export function parseSignature(text) {
  const line = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim();
  const flags = /flags=0x([0-9a-f]+)/.exec(text);
  return {
    authority: line('Authority'),
    team: line('TeamIdentifier'),
    timestamp: line('Timestamp'),
    runtime: flags ? (parseInt(flags[1], 16) & 0x10000) !== 0 : false,
    adhoc: /Signature=adhoc/.test(text),
  };
}

/**
 * Why `file` breaks the policy (Developer ID of `team`, hardened runtime, secure timestamp, strict verify), or
 * undefined when it doesn't.
 */
export async function signatureProblem(file, team) {
  try {
    await exec(CODESIGN, ['--verify', '--strict', file]);
  } catch (error) {
    return `codesign --verify --strict failed: ${String(error.stderr ?? error).trim()}`;
  }
  const { stderr } = await exec(CODESIGN, ['-dvv', file]);
  const signature = parseSignature(stderr);
  if (signature.adhoc) return 'ad-hoc signed';
  if (!signature.authority?.startsWith('Developer ID Application:'))
    return `signed by ${signature.authority ?? 'nobody'}, not a Developer ID Application`;
  if (signature.team !== team) return `team ${signature.team}, expected ${team}`;
  if (!signature.runtime) return 'no hardened runtime';
  if (!signature.timestamp) return 'no secure timestamp';
  return undefined;
}

/** The entitlement keys in a codesign --entitlements XML plist (empty for none). */
export function parseEntitlementKeys(xml) {
  return [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]).sort();
}

/** The entitlements `file` is signed with, by key. */
export async function entitlementKeys(file) {
  const { stdout } = await exec(CODESIGN, ['-d', '--entitlements', '-', '--xml', file]);
  return parseEntitlementKeys(stdout);
}

/**
 * Every Mach-O among `entries` under `root` with what's wrong with it (empty when all pass). With `entitlements`
 * ({ path: allowed keys }), a Mach-O signed with any entitlement its path doesn't allow is a problem too.
 */
export async function treeProblems(root, entries, team, { entitlements } = {}) {
  const machO = await machOFiles(root, entries);
  const problems = [];
  for (const path of machO) {
    const problem = await signatureProblem(join(root, path), team);
    if (problem) problems.push(`${path}: ${problem}`);
    if (!entitlements) continue;
    const allowed = new Set(entitlements[path] ?? []);
    for (const key of await entitlementKeys(join(root, path)))
      if (!allowed.has(key)) problems.push(`${path}: entitlement ${key} is not allowed`);
  }
  return { count: machO.length, problems };
}
