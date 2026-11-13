// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Rust crates V8 compiles into rusty_v8's static library for its Temporal support
 * (//third_party/rust/temporal_capi), read from the gnrt-generated BUILD.gn files the v8 crate ships: each target's
 * cargo_pkg_name, cargo_pkg_version, crate_type and deps, followed from temporal_capi. Procedural macros run at
 * build time and are left out with their deps; so are deps that only another platform's build adds (an `if` on
 * is_win, is_android, is_linux, is_chromeos, is_fuchsia or is_ios, unless it also names is_mac, is_apple or is_posix).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { byteOrder } from '../hosting/files.mjs';

const OTHER_PLATFORM = /(^|[^!\w])(is_win|is_android|is_linux|is_chromeos|is_fuchsia|is_ios)\b/;
const THIS_PLATFORM = /\b(is_mac|is_apple|is_posix)\b/;

/** One BUILD.gn → { name, version, type, group (a GN group, not a crate), deps: [label] } (public_deps too). */
export function parseGnCrate(text) {
  const field = (name) => new RegExp(`^\\s*${name} = "([^"]*)"`, 'm').exec(text)?.[1];
  const deps = [];
  const blocks = [];
  let collecting = false;
  for (const line of text.split('\n')) {
    const opened = /^\s*(?:\} else )?if \((.*)\) \{\s*$/.exec(line);
    if (opened) {
      if (/^\s*\}/.test(line)) blocks.pop();
      blocks.push(OTHER_PLATFORM.test(opened[1]) && !THIS_PLATFORM.test(opened[1]));
      continue;
    }
    const skipped = blocks.some(Boolean);
    if (!collecting && /^\s*(public_)?deps \+?= \[/.test(line)) collecting = true;
    if (collecting) {
      if (!skipped) deps.push(...[...line.matchAll(/"(\/\/[^"]+)"/g)].map((match) => match[1]));
      if (line.includes(']')) collecting = false;
      continue;
    }
    if (/^\s*\}\s*$/.test(line) && blocks.length > 0) blocks.pop();
  }
  return {
    name: field('cargo_pkg_name'),
    version: field('cargo_pkg_version'),
    type: field('crate_type'),
    group: /^group\(/m.test(text),
    deps,
  };
}

/** `//third_party/rust/x/v1:lib` → `third_party/rust/x/v1/BUILD.gn`. */
const buildFile = (label) => `${label.slice(2).split(':')[0]}/BUILD.gn`;

/**
 * The crates linked from `start` (a GN label; a group is followed through) under `root` (the v8 crate's folder):
 * [{ name, version }], sorted.
 */
export async function gnRustClosure(root, start, read = (path) => readFile(path, 'utf8')) {
  const found = new Map();
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const label = queue.shift();
    if (seen.has(label)) continue;
    seen.add(label);
    if (!label.startsWith('//third_party/rust/')) continue;
    const crate = parseGnCrate(await read(join(root, buildFile(label))));
    if (!crate.name && crate.group) {
      queue.push(...crate.deps);
      continue;
    }
    if (!crate.name || !crate.version) throw new Error(`${label}: no cargo_pkg_name or cargo_pkg_version`);
    if (crate.type === 'proc-macro') continue;
    found.set(`${crate.name}@${crate.version}`, { name: crate.name, version: crate.version });
    queue.push(...crate.deps);
  }
  return [...found.values()].sort((a, b) => byteOrder(a.name, b.name) || byteOrder(a.version, b.version));
}
