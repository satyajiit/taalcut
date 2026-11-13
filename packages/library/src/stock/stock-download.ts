// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Download one rendition to a staging file, streamed: the size cap is checked
 * against Content-Length first and then chunk by chunk, so an oversized body is
 * never held in memory. No API key is sent.
 */
import { copyFile, mkdir, open, rename, rm, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CancelledError, err, ok, toTaalcutError, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { StockDownloadFailed, StockTooLarge } from '../errors';
import { headerValue, type StockHttp } from './stock-provider';

export async function downloadStock(
  http: StockHttp,
  url: string,
  dest: string,
  signal: AbortSignal,
  maxBytes: number,
): AsyncResult<{ bytes: number; contentType: string }> {
  if (signal.aborted) return err(CancelledError());
  const response = await http.stream(url, {}, signal);
  if (!response.ok) return err(signal.aborted ? CancelledError() : StockDownloadFailed());
  const { status, headers, body } = response.value;
  if (status < 200 || status >= 300) return err(StockDownloadFailed());
  const contentType = (headerValue(headers, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!allowedType(contentType)) return err(StockDownloadFailed());
  const declared = Number(headerValue(headers, 'content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return err(StockTooLarge());
  const handle = await openStaging(dest);
  if (!handle) return err(StockDownloadFailed());
  const written = await writeChunks(handle, body, signal, maxBytes);
  const closed = await handle.close().then(
    () => true,
    () => false,
  );
  if (!written.ok) return written;
  // A close that fails can mean the last write never reached the disk.
  if (!closed) return err(StockDownloadFailed());
  return ok({ bytes: written.value, contentType });
}

async function openStaging(dest: string): Promise<FileHandle | null> {
  try {
    await mkdir(dirname(dest), { recursive: true });
    return await open(dest, 'w');
  } catch {
    // No folder or no file to write: the caller reports stock_download_failed.
    return null;
  }
}

async function writeChunks(
  handle: FileHandle,
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  maxBytes: number,
): AsyncResult<number> {
  let written = 0;
  try {
    for await (const chunk of body) {
      if (signal.aborted) return err(CancelledError());
      if (written + chunk.byteLength > maxBytes) return err(StockTooLarge());
      await handle.write(chunk);
      written += chunk.byteLength;
    }
    return ok(written);
  } catch {
    // The connection dropped mid-body, or the disk refused a write.
    return err(signal.aborted ? CancelledError() : StockDownloadFailed());
  }
}

/** Deletes `path`. A file that is already gone is fine; any other failure is returned. */
export async function removeStockFile(path: string): AsyncResult<void> {
  try {
    await rm(path, { force: true });
    return ok(undefined);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

/** Removes a staging or placed file on a path that already failed; a second failure is only logged. */
export async function cleanUpStockFile(path: string, log?: (message: string) => void): Promise<void> {
  const removed = await removeStockFile(path);
  if (!removed.ok) log?.(`stock import: could not remove a partial file (${codeOf(removed.error)})`);
}

function codeOf(error: TaalcutError): string {
  return error.detail ? `${error.code}: ${error.detail}` : error.code;
}

export async function placeStockFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch {
    // Another volume (EXDEV) or a rename the filesystem refuses: copy, then drop the staging file.
    await copyFile(from, to);
    await unlink(from);
  }
}

export function safeStockId(providerId: string): string {
  const cleaned = providerId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'item';
}

export function extensionFor(contentType: string, url: string): string {
  const known: Readonly<Record<string, string>> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
  };
  const mapped = known[contentType];
  if (mapped) return mapped;
  if (contentType !== '' && contentType !== 'application/octet-stream') return 'bin';
  const parsed = URL.canParse(url) ? new URL(url) : null;
  const leaf = parsed?.pathname.split('/').pop() ?? '';
  const ext = leaf.includes('.') ? (leaf.split('.').pop() ?? '') : '';
  return /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin';
}

function allowedType(contentType: string): boolean {
  return (
    contentType === '' ||
    contentType === 'application/octet-stream' ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  );
}
