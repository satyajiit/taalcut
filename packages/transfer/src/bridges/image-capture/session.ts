// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One open ImageCaptureCore device. ImageCaptureCore writes whole originals
 * (no ranged reads); the sha256 is of the file the helper wrote, and each
 * download lands in its own folder beside the `.part` (files.ts).
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import type { BridgeSession, DeviceAccess, DeviceItem, PullOptions, PullResult } from '../../usb/bridge';
import type { HelperEndpoint } from './client';
import { abortError, bridgeFailure, HelperRequestError, helperCodeOf, isAbortError } from './failures';
import { downloadFolder, freshFolder, hashFile, insideReal, placeAt } from './files';
import { mapItemPage, readThumbPath, readWrittenFile, type MappedRef } from './map';

const PAGE_LIMIT = 500;
const THUMB_EDGE = 256;

export type HelperParams = Readonly<Record<string, string | number | boolean | null>>;

export class LiveSession implements BridgeSession {
  /** ImageCaptureCore writes the whole original. `offset` is ignored. */
  readonly rangedReads = false;
  removed = false;
  private accessState: DeviceAccess;
  private readonly accessListeners = new Set<(access: DeviceAccess) => void>();
  private progressId: string | undefined;
  private progress: ((received: number) => void) | undefined;

  constructor(
    private readonly endpoint: HelperEndpoint,
    readonly ref: MappedRef,
    access: DeviceAccess,
    /** Where thumbnails are written: a folder the helper may write to (`--allow-root`). */
    private readonly scratchDir: string,
    /** Forgets the session; once nothing uses the helper the bridge stops it. */
    private readonly onClose: (session: LiveSession) => Promise<void>,
  ) {
    this.accessState = access;
  }

  access(): DeviceAccess {
    return this.accessState;
  }

  onAccessChange(listener: (access: DeviceAccess) => void): () => void {
    this.accessListeners.add(listener);
    return () => this.accessListeners.delete(listener);
  }

  markRemoved(): void {
    this.removed = true;
  }

  setAccess(access: DeviceAccess): void {
    this.accessState = access;
    for (const listener of this.accessListeners) listener(access);
  }

  noteBytes(id: string, bytes: number): void {
    if (this.progressId === id) this.progress?.(bytes);
  }

  async *list(signal: AbortSignal): AsyncIterable<readonly DeviceItem[]> {
    let cursor = 0;
    for (;;) {
      if (signal.aborted || this.removed) {
        if (this.removed) throw bridgeFailure(new HelperRequestError('devices.not_found'), this.context());
        return;
      }
      let page: ReturnType<typeof mapItemPage>;
      try {
        const payload = await callHelper(
          this.endpoint,
          'devices.list',
          { handle: this.ref.handle, cursor, limit: PAGE_LIMIT },
          signal,
        );
        page = mapItemPage(payload);
      } catch (cause) {
        if (signal.aborted || isAbortError(cause)) return;
        throw bridgeFailure(cause, this.context());
      }
      if (!page) throw bridgeFailure(new HelperRequestError('devices.session_failed'), this.context());
      if (page.items.length > 0) yield page.items;
      if (page.nextCursor === undefined || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    }
  }

  async thumbnail(itemId: string, signal: AbortSignal): AsyncResult<Uint8Array | null> {
    if (this.removed) return err(bridgeFailure(new HelperRequestError('devices.not_found'), this.context()));
    let directory: string | undefined;
    try {
      await mkdir(this.scratchDir, { recursive: true });
      directory = await mkdtemp(join(this.scratchDir, '.icc-thumb-'));
      const dest = join(directory, 'thumb.jpg');
      const payload = await callHelper(
        this.endpoint,
        'devices.thumbnail',
        { handle: this.ref.handle, id: itemId, maxPixel: THUMB_EDGE, dest },
        signal,
      );
      const path = readThumbPath(payload);
      if (path === null) return ok(null);
      if (path === undefined || !(await insideReal(directory, path))) {
        throw new HelperRequestError('devices.session_failed');
      }
      return ok(new Uint8Array(await readFile(path)));
    } catch (cause) {
      return err(bridgeFailure(cause, this.context()));
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  async pull(itemId: string, options: PullOptions): AsyncResult<PullResult> {
    if (this.removed) return err(bridgeFailure(new HelperRequestError('devices.not_found'), this.context()));
    const folder = downloadFolder(options.dest);
    this.progressId = itemId;
    this.progress = options.onBytes;
    try {
      await freshFolder(folder);
      const payload = await callHelper(
        this.endpoint,
        'devices.download',
        { handle: this.ref.handle, id: itemId, destDir: folder, offset: 0 },
        options.signal,
      );
      const written = readWrittenFile(payload);
      if (!written || !(await insideReal(folder, written.file))) {
        throw new HelperRequestError('devices.session_failed');
      }
      const hashed = await hashFile(written.file);
      await placeAt(written.file, options.dest);
      // Companions (an `.AAE` edit) are not media: they go with the folder below, never imported.
      return ok({ bytes: hashed.bytes, sha256: hashed.sha256, ancillary: [] });
    } catch (cause) {
      return err(bridgeFailure(cause, this.context()));
    } finally {
      this.progressId = undefined;
      this.progress = undefined;
      await rm(folder, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    if (!this.removed) {
      try {
        await callHelper(
          this.endpoint,
          'devices.close',
          { handle: this.ref.handle },
          AbortSignal.timeout(5_000),
        );
      } catch (cause) {
        // Close must not throw: the helper may be gone already, and it frees the session when it exits.
        if (!(cause instanceof HelperRequestError) && !isAbortError(cause)) throw cause;
      }
    }
    await this.onClose(this);
  }

  private context(): { readonly removed: boolean; readonly access: DeviceAccess } {
    return { removed: this.removed, access: this.accessState };
  }
}

/** A helper call that rejects with a HelperRequestError, or an AbortError once `signal` fired. */
export async function callHelper(
  endpoint: HelperEndpoint,
  method: string,
  params: HelperParams,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw abortError();
  try {
    return await endpoint.request(method, params, signal);
  } catch (cause) {
    if (signal.aborted || isAbortError(cause)) throw abortError();
    if (cause instanceof HelperRequestError) throw cause;
    throw new HelperRequestError(helperCodeOf(cause) ?? 'devices.session_failed');
  }
}
