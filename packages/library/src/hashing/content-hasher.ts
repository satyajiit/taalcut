// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content hashing (ADR 0001, "Content hashing"): BLAKE3-256 of the whole file
 * is an asset's identity; XXH3-128 over a fixed sample of the file (the
 * partial hash) finds relink and duplicate candidates cheaply and decides
 * nothing alone.
 *
 * The default hasher is hash-wasm's WebAssembly build (MIT): same digests as
 * the native bindings the ADR measured (its known answers are tested), no
 * native module to unpack from the ASAR and sign, and the same code in every
 * process. A native hasher can be injected through the port.
 */
import { open, type FileHandle } from 'node:fs/promises';
import { CancelledError, err, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import { createBLAKE3, createXXHash128, type IHasher } from 'hash-wasm';

/** Hex digests. */
export interface ContentHasher {
  /** BLAKE3-256 of every byte (64 hex digits). Streams the file; abortable. */
  full(path: string, options?: { readonly signal?: AbortSignal }): AsyncResult<string>;
  /** XXH3-128 of the ADR's sampled layout (32 hex digits). Reads at most 3 MiB. */
  partial(path: string, options?: { readonly signal?: AbortSignal }): AsyncResult<string>;
}

/** The ADR's partial-hash window: 1 MiB from the start, the middle and the end. */
export const PARTIAL_WINDOW_BYTES = 1_048_576;
/** At or above this size the three windows are sampled; below it the whole file is hashed. */
export const PARTIAL_SAMPLE_THRESHOLD = 3 * PARTIAL_WINDOW_BYTES;

const CHUNK_BYTES = 1_048_576;

/** Where the partial hash reads, after the size prefix: [start, length] pairs. */
export function partialWindows(size: number): (readonly [number, number])[] {
  if (size < PARTIAL_SAMPLE_THRESHOLD) return [[0, size]];
  const half = PARTIAL_WINDOW_BYTES / 2;
  return [
    [0, PARTIAL_WINDOW_BYTES],
    [Math.floor(size / 2) - half, PARTIAL_WINDOW_BYTES],
    [size - PARTIAL_WINDOW_BYTES, PARTIAL_WINDOW_BYTES],
  ];
}

/** The little-endian uint64 file size the partial hash starts with. */
export function sizePrefix(size: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(size), true);
  return bytes;
}

async function readRange(
  file: FileHandle,
  hasher: IHasher,
  start: number,
  length: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, Math.max(1, length)));
  let offset = start;
  let left = length;
  while (left > 0) {
    if (signal?.aborted) throw new Aborted();
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, left), offset);
    if (bytesRead === 0) break; // The file shrank under us: hash what is there.
    hasher.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
    left -= bytesRead;
  }
}

class Aborted extends Error {}

async function hashFile(
  path: string,
  make: () => Promise<IHasher>,
  feed: (file: FileHandle, hasher: IHasher, size: number) => Promise<void>,
  signal: AbortSignal | undefined,
): AsyncResult<string> {
  if (signal?.aborted) return err(CancelledError());
  let file: FileHandle | undefined;
  try {
    file = await open(path, 'r');
    const { size } = await file.stat();
    const hasher = await make();
    hasher.init();
    await feed(file, hasher, size);
    return ok(hasher.digest('hex'));
  } catch (cause) {
    if (cause instanceof Aborted) return err(CancelledError());
    return err(toTaalcutError(cause));
  } finally {
    await file?.close();
  }
}

/** The default ContentHasher (hash-wasm, WebAssembly). One hasher instance per file, so calls may overlap. */
export function createWasmContentHasher(): ContentHasher {
  return {
    full: (path, options = {}) =>
      hashFile(
        path,
        () => createBLAKE3(),
        (file, hasher, size) => readRange(file, hasher, 0, size, options.signal),
        options.signal,
      ),
    partial: (path, options = {}) =>
      hashFile(
        path,
        // Seed 0 (8 zero bytes), as in the ADR's bench.
        () => createXXHash128(0, 0),
        async (file, hasher, size) => {
          hasher.update(sizePrefix(size));
          for (const [start, length] of partialWindows(size)) {
            await readRange(file, hasher, start, length, options.signal);
          }
        },
        options.signal,
      ),
  };
}

/** BLAKE3 and XXH3-128 of bytes in memory (tests, small payloads). */
export async function hashBytes(bytes: Uint8Array): Promise<{ blake3: string; xxh128: string }> {
  const blake3 = await createBLAKE3();
  const xxh = await createXXHash128(0, 0);
  blake3.init().update(bytes);
  xxh.init().update(bytes);
  return { blake3: blake3.digest('hex'), xxh128: xxh.digest('hex') };
}
