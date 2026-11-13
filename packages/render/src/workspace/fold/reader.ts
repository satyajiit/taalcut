// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A project's workspace blobs read from disk (HFW1): `<root>/workspaces/<projectId>/blobs/<2hex>/<sha256>` (core's
 * `workspaceBlobPath`, the library's store writes them). Texts are read whole (64 KB at most); an asset's type is
 * read from its first bytes (PNG, JPEG, WebP, GIF or SVG), so the bundle serves it as what it is. Synchronous: the
 * compile is, and blobs are small.
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WORKSPACE_LIMITS, workspaceBlobPath } from '@taalcut/core';
import type { WorkspaceAsset, WorkspaceReader } from './types';

/** The image type a file's first bytes say, or undefined. */
export function sniffImage(head: Uint8Array): WorkspaceAsset['ext'] | undefined {
  const at = (index: number) => head[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg';
  const ascii = (start: number, end: number) => String.fromCharCode(...head.slice(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  const text = new TextDecoder().decode(head).trimStart();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'svg';
  return undefined;
}

function readHead(file: string, bytes: number): Uint8Array | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const head = new Uint8Array(bytes);
    const read = readSync(fd, head, 0, bytes, 0);
    return head.slice(0, read);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** A reader of one project's workspace under the app's user-data folder. */
export function workspaceReaderAt(
  root: string,
  projectId: string,
  maxFileBytes: number = WORKSPACE_LIMITS.fileBytes,
  verifyHash = false,
): WorkspaceReader {
  const fileOf = (sha256: string) => {
    try {
      return join(root, workspaceBlobPath(projectId, sha256));
    } catch {
      return undefined;
    }
  };
  return {
    text(sha256) {
      const file = fileOf(sha256);
      if (!file) return undefined;
      try {
        if (statSync(file).size > maxFileBytes) return undefined;
        const bytes = readFileSync(file);
        if (verifyHash && createHash('sha256').update(bytes).digest('hex') !== sha256) return undefined;
        return bytes.toString('utf8');
      } catch {
        return undefined;
      }
    },
    asset(sha256) {
      const file = fileOf(sha256);
      if (verifyHash && file) {
        try {
          if (
            statSync(file).size > maxFileBytes ||
            createHash('sha256').update(readFileSync(file)).digest('hex') !== sha256
          )
            return undefined;
        } catch {
          return undefined;
        }
      }
      const head = file ? readHead(file, 256) : undefined;
      const ext = head ? sniffImage(head) : undefined;
      return file && ext ? { file, ext } : undefined;
    },
  };
}
