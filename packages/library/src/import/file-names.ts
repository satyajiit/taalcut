// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a phone's upload lands in the originals root (P2-L3):
 * `<root>/<YYYY>/<YYYY-MM-DD>/<file name>`, dated by the Mac's local day it
 * arrived, the name sanitised again (the phone's browser sent it: NFC, no
 * separators or control characters, at most 255 bytes) and ` (2)`, ` (3)`…
 * before the extension when the name is taken.
 */
import { access } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MAX_NAME_BYTES = 255;
const utf8 = new TextEncoder();

/** Cuts text to at most `bytes` UTF-8 bytes without splitting a character. */
function cutBytes(text: string, bytes: number): string {
  let out = '';
  for (const char of text) {
    if (utf8.encode(out + char).length > bytes) break;
    out += char;
  }
  return out;
}

/** A safe file name from what the phone sent. */
export function sanitiseFileName(name: string): string {
  const clean = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:]/g, '_')
    .trim()
    // A leading dot would hide the file in Finder.
    .replace(/^\.+/, '_');
  const safe = clean === '' || clean === '_' ? 'upload' : clean;
  const extension = extname(safe).slice(0, 32);
  const stem = safe.slice(0, safe.length - extension.length);
  return cutBytes(stem, MAX_NAME_BYTES - utf8.encode(extension).length) + extension;
}

/** `<YYYY>/<YYYY-MM-DD>` for a time, in the Mac's local calendar (folders are for people). */
export function datedFolder(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${year}/${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The first free `<folder>/<name>`, `<folder>/<stem> (2)<ext>`, …, keeping each name within 255 bytes. */
export async function freeName(folder: string, name: string): Promise<string> {
  if (!(await exists(join(folder, name)))) return name;
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate =
      cutBytes(stem, MAX_NAME_BYTES - utf8.encode(suffix + extension).length) + suffix + extension;
    if (!(await exists(join(folder, candidate)))) return candidate;
  }
}
