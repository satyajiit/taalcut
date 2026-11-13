// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Third-party code inside Deno's own crates (Node.js's polyfills, TypeScript, type definitions), found by the
 * copyright lines in each source file's first comment that are not the Deno authors'. The notice quotes those
 * comments as they stand, grouped, with the files they head, and the licence texts they refer to (noticeTexts).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { byteOrder } from '../hosting/files.mjs';

const SOURCE = /\.(c|cc|cjs|cts|h|js|jsx|mjs|mts|rs|ts|tsx)$/;
const NOT_SHIPPED = /^(\.git|benches?|examples?|fixtures|node_modules|testdata|tests?)$/;

/** The comment a file starts with (after a #! line): consecutive // lines, or one block comment. */
export function leadingComment(text) {
  const body = text.replace(/^\uFEFF/u, '').replace(/^#![^\n]*\n/, '');
  const trimmed = body.replace(/^\s+/, '');
  if (trimmed.startsWith('/*')) {
    const end = trimmed.indexOf('*/');
    return end === -1 ? '' : trimmed.slice(0, end + 2);
  }
  const lines = [];
  for (const line of trimmed.split('\n')) {
    if (!/^\s*\/\//.test(line)) break;
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

/** The copyright lines of a comment that are not the Deno authors'. */
export function foreignCopyrights(comment) {
  return comment
    .split('\n')
    .map((line) => line.replace(/^[\s/*!]+/, '').trim())
    .filter((line) => /\bcopyright\b/i.test(line) && !/copyright (notice|holders)/i.test(line))
    .filter((line) => !/the Deno authors/.test(line));
}

async function sourceFiles(dir, prefix = '') {
  const found = [];
  const entries = await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => byteOrder(a.name, b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !NOT_SHIPPED.test(entry.name)) found.push(...(await sourceFiles(dir, path)));
    else if (entry.isFile() && SOURCE.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Scans `dirs` (the path crates' folders) under `root` and returns [{ comment, holders, files }]: each distinct
 * first comment that names a holder other than the Deno authors, the files it heads (relative to `root`), sorted.
 */
export async function embeddedNotices(root, dirs) {
  const files = new Set();
  for (const dir of dirs)
    for (const path of await sourceFiles(dir)) files.add(relative(root, join(dir, path)));
  const byComment = new Map();
  for (const path of [...files].sort(byteOrder)) {
    const comment = leadingComment(await readFile(join(root, path), 'utf8'));
    const holders = foreignCopyrights(comment);
    if (holders.length === 0) continue;
    const entry = byComment.get(comment) ?? { comment, holders, files: [] };
    entry.files.push(path);
    byComment.set(comment, entry);
  }
  return [...byComment.values()];
}

const SAYS_MIT = /\bMIT\b|Permission is hereby granted, free of charge/;

/**
 * The text ids each notice refers to ({ notice, texts }): its holders' EMBEDDED entries, or the MIT text when a
 * holder has none and the comment says MIT. Throws naming every holder that is neither.
 */
export function noticeTexts(notices, embedded) {
  const unknown = new Set();
  const matched = notices.map((notice) => {
    const texts = new Set();
    for (const line of notice.holders) {
      const entry = embedded.find((candidate) => candidate.holder.test(line));
      if (entry) for (const id of entry.texts) texts.add(id);
      else if (SAYS_MIT.test(notice.comment)) texts.add('mit');
      else unknown.add(line);
    }
    return { notice, texts: [...texts].sort(byteOrder) };
  });
  if (unknown.size > 0)
    throw new Error(
      `copyright holders in Deno's own source with no EMBEDDED entry (deno/pins.mjs):\n  ${[...unknown].sort(byteOrder).join('\n  ')}`,
    );
  return matched;
}
