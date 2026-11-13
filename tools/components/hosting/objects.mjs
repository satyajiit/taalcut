// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an object in the bucket is: its key, and the headers it is served with. Every object is immutable: a
 * changed file gets a new version, so a key never changes bytes and caches may keep it forever. That includes the
 * corresponding sources and the notices, whose size and sha256 the manifest pins (`licence.notice`); a notice's
 * name is its own content (`NOTICE-<sha256 prefix>.txt`), so correcting one never touches the component's version.
 */

export const IMMUTABLE = 'public, max-age=31536000, immutable';

const KEY_SEGMENT = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/** `<id>/<version>/<file>`, every segment checked so a key never needs escaping and never climbs out. */
export function objectKey(id, version, file) {
  const segments = [id, version, ...file.split('/')];
  for (const segment of segments)
    if (!KEY_SEGMENT.test(segment) || segment === '..') throw new Error(`not a key segment: ${segment}`);
  return segments.join('/');
}

/**
 * Binary types Cloudflare never compresses, so Content-Length is the file's size (the app sends identity). A
 * `.crate` is a gzipped tar (crates.io's own format).
 */
/**
 * The file name of a notice whose sha256 is `sha256`: content-addressed, so a corrected notice for the same
 * component bytes gets a new key without a new version (the app compares versions and file hashes, never notices,
 * to decide on an update). Sixteen hex digits name it; the manifest pins the whole hash, and an upload never
 * replaces a key's bytes, so a clash could only fail loudly.
 */
export function noticeFile(sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a sha256: ${sha256}`);
  return `NOTICE-${sha256.slice(0, 16)}.txt`;
}

export function contentType(key) {
  if (key.endsWith('.tar.zst')) return 'application/zstd';
  if (key.endsWith('.tar.gz') || key.endsWith('.tgz') || key.endsWith('.crate')) return 'application/gzip';
  if (key.endsWith('.tar.xz')) return 'application/x-xz';
  if (key.endsWith('.zip')) return 'application/zip';
  if (key.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export function cacheControl() {
  return IMMUTABLE;
}

export function publicUrl(base, key) {
  return `${base.replace(/\/+$/, '')}/${key}`;
}
