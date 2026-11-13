// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  toTaalcutError,
  ValidationError,
  type AsyncResult,
  type ProductKnowledgeInput,
  type ProductSource,
} from '@taalcut/core';
import { redactText } from '@taalcut/library';
import { resolveCreationDirectory } from '../../shared/creation-grants';
import { EXCLUDED_SOURCE_ENTRY, sourceEntryCurrent } from '../../shared/source-containment';

const TEXT = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.html',
  '.css',
  '.svg',
  '.toml',
  '.swift',
  '.rs',
  '.py',
  '.go',
]);
const MAX_ENTRIES = 50_000;
const MAX_DOCUMENTS = 2000;
const MAX_BYTES = 8 * 1024 * 1024;
type CachedFile = { stamp: string; digest: string; text: string };
type Manifest = Record<string, CachedFile>;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

async function readManifest(path: string): Promise<Manifest> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES * 4) return {};
      text = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          value &&
          typeof value === 'object' &&
          typeof value.stamp === 'string' &&
          typeof value.digest === 'string' &&
          /^[a-f0-9]{64}$/.test(value.digest) &&
          typeof value.text === 'string' &&
          value.text.length <= 24_000,
      ),
    );
  } catch {
    return {};
  }
}

async function readEvidenceFile(
  root: string,
  path: string,
  previous?: CachedFile,
): Promise<CachedFile | null> {
  const absolute = resolve(root, path);
  // Check parents too: O_NOFOLLOW protects only the final path component.
  const canonical = await realpath(absolute);
  if (canonical !== absolute || !canonical.startsWith(`${root}${sep}`)) return null;
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (!(await sourceEntryCurrent(root, absolute, stat))) return null;
    if (previous?.stamp === stamp) return { ...previous, text: redactText(previous.text) };
    const buffer = Buffer.alloc(512 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer);
    if (bytesRead !== stat.size || !(await sourceEntryCurrent(root, absolute, stat))) return null;
    const data = buffer.subarray(0, bytesRead);
    if (data.includes(0)) return null;
    const clean = redactText(data.toString('utf8')).trim();
    if (!clean) return null;
    const text =
      clean.length > 23_800
        ? `${clean.slice(0, 23_800)}\n[Source excerpt; remaining text was not indexed.]`
        : clean;
    return { stamp, digest: hash(data), text };
  } finally {
    await handle.close();
  }
}

/** Incremental read-only evidence, separate from the disposable copies used for live capture. */
export async function productDirectoryEvidence(
  userData: string,
  source: ProductSource,
  signal: AbortSignal,
  now = Date.now(),
): AsyncResult<ProductKnowledgeInput[]> {
  if (signal.aborted) return err(CancelledError());
  if (!source.accessId)
    return err(ValidationError({ field: 'source' }, { detail: 'Choose a project folder again.' }));
  const grant = await resolveCreationDirectory(userData, source.accessId);
  if (!grant.ok) return grant;
  const root = await realpath(grant.value).catch(() => null);
  if (!root)
    return err(ValidationError({ field: 'source' }, { detail: 'The attached folder is unavailable.' }));
  const manifestPath = join(userData, 'products', 'indexes', `${hash(source.accessId)}.json`);
  const previous = await readManifest(manifestPath);
  const next: Manifest = {};
  const documents: ProductKnowledgeInput[] = [];
  let entriesSeen = 0;
  let bytes = 0;
  let limited = false;
  const walk = async (path: string, depth: number): Promise<void> => {
    if (signal.aborted) return;
    if (depth > 32 || entriesSeen >= MAX_ENTRIES) {
      limited = true;
      return;
    }
    const canonical = await realpath(path);
    if (canonical !== path || (path !== root && !path.startsWith(`${root}${sep}`))) return;
    const entries = await readdir(path, { withFileTypes: true });
    const priority = (name: string) => (/^(readme|changelog|package\.json)/i.test(name) ? 0 : 1);
    entries.sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (signal.aborted) return;
      if (++entriesSeen > MAX_ENTRIES) {
        limited = true;
        return;
      }
      if (EXCLUDED_SOURCE_ENTRY.test(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1).catch(() => {
          limited = true;
        });
        continue;
      }
      if (!entry.isFile() || !TEXT.has(extname(entry.name).toLowerCase())) continue;
      if (documents.length >= MAX_DOCUMENTS || bytes >= MAX_BYTES) {
        limited = true;
        continue;
      }
      const locator = relative(root, absolute).split(sep).join('/');
      const file = await readEvidenceFile(root, locator, previous[locator]).catch(() => {
        limited = true;
        return null;
      });
      if (!file) continue;
      if (bytes + Buffer.byteLength(file.text) > MAX_BYTES) {
        limited = true;
        continue;
      }
      next[locator] = file;
      bytes += Buffer.byteLength(file.text);
      documents.push({
        sourceId: source.id,
        locator,
        digest: file.digest,
        title: locator.slice(0, 500),
        text: file.text,
        capturedAt: now,
      });
    }
  };
  try {
    await walk(root, 0);
    if (signal.aborted) return err(CancelledError());
    if (limited)
      documents.push({
        sourceId: source.id,
        locator: 'taalcut:index-coverage',
        digest: hash(`${entriesSeen}:${documents.length}:${bytes}`),
        title: 'Source coverage',
        capturedAt: now,
        text: `This source index is bounded. ${documents.length} documents were indexed. Some files were omitted; missing evidence must not be treated as an absent feature. Attach a narrower project directory for complete coverage.`,
      });
    await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
    const temporary = `${manifestPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, manifestPath);
    return ok(documents);
  } catch (cause) {
    return signal.aborted ? err(CancelledError()) : err(toTaalcutError(cause));
  }
}
