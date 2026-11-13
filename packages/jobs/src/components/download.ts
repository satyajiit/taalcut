// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A resumable, verified download of one file (G13).
 *
 * Bytes go to `<part>`; what they came from goes to `<part>.json`. A later run
 * (after a cancel, a crash or a kill) re-hashes the part and asks for the rest
 * with `Range` and `If-Range`, so an unchanged file resumes and a changed one
 * restarts from zero. The sha256 is computed as the bytes are written; a
 * mismatch deletes the part. A verified file is renamed to `finalPath`.
 */
import { createHash, type Hash } from 'node:crypto';
import { open, rename, type FileHandle } from 'node:fs/promises';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { ChecksumMismatch, DiskSpaceLow, DownloadFailed, InstallFailed, SizeMismatch } from './errors';
import { fileSize, hashFileInto, isErrnoException, removeQuietly, writeAll } from './fs-util';
import { describeCause, type FetchLike } from './http';
import {
  classifyResponse,
  followRedirect,
  isRedirectStatus,
  requestHeaders,
  type RequestState,
} from './response';
import { discardPart, metaPathFor, readPartMeta, writePartMeta, type PartMeta } from './resume-state';
import { backoffDelay, DEFAULT_DOWNLOAD_RETRY, sleep, type RetryPolicy, type Sleep } from './retry';

export interface DownloadTarget {
  /** Component id, used in error params. */
  readonly label: string;
  readonly urls: readonly string[];
  readonly size: number;
  readonly sha256: string;
}

export type DownloadPhase = 'checking' | 'downloading' | 'verifying';

export interface DownloadOptions {
  readonly fetch: FetchLike;
  readonly signal?: AbortSignal;
  readonly retry?: RetryPolicy;
  /** Time allowed for the response headers. Default 30 s. */
  readonly headersTimeoutMs?: number;
  /** Time allowed between two body chunks. Default 30 s. */
  readonly stallTimeoutMs?: number;
  readonly sleep?: Sleep;
  readonly random?: () => number;
  /** 'checking' while re-hashing a partial file, 'downloading' as bytes land, 'verifying' at the end. */
  readonly onBytes?: (phase: DownloadPhase, bytesDone: number, bytesTotal: number) => void;
  /**
   * A network error this download will retry: `attempt` counts the failures in a row (1-based), and the next try
   * starts after `delayMs`. The window says "Reconnecting…" meanwhile, rather than a bar that just stops.
   */
  readonly onRetry?: (retry: DownloadRetry) => void;
}

export interface DownloadRetry {
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: TaalcutError;
}

export interface DownloadResult {
  readonly path: string;
  /** Bytes already on disk when this run started (0 for a fresh download). */
  readonly resumedFrom: number;
  /** Bytes received over the network in this run. */
  readonly bytesFetched: number;
}

type Outcome =
  | { kind: 'complete' }
  | { kind: 'stop'; error: TaalcutError }
  | { kind: 'next-mirror'; error: TaalcutError }
  | { kind: 'retry'; error: TaalcutError; progressed: boolean; retryAfterMs?: number; immediate?: boolean };

/** Downloads `target` into `partPath`, verifies it and renames it to `finalPath`. */
export function downloadVerified(
  target: DownloadTarget,
  partPath: string,
  finalPath: string,
  options: DownloadOptions,
): AsyncResult<DownloadResult> {
  return new ResumableDownload(target, partPath, finalPath, options).run();
}

class ResumableDownload {
  private hash: Hash = createHash('sha256');
  private offset = 0;
  private meta: PartMeta | undefined;
  private resumedFrom = 0;
  private bytesFetched = 0;
  private readonly retry: RetryPolicy;
  private readonly headersTimeoutMs: number;
  private readonly stallTimeoutMs: number;

  constructor(
    private readonly target: DownloadTarget,
    private readonly partPath: string,
    private readonly finalPath: string,
    private readonly options: DownloadOptions,
  ) {
    this.retry = options.retry ?? DEFAULT_DOWNLOAD_RETRY;
    this.headersTimeoutMs = options.headersTimeoutMs ?? 30_000;
    this.stallTimeoutMs = options.stallTimeoutMs ?? 30_000;
  }

  async run(): AsyncResult<DownloadResult> {
    try {
      const finished = await this.reuseFinishedFile();
      if (finished) return ok(finished);
      await this.loadPart();
    } catch (cause) {
      return err(this.localError(cause));
    }
    if (this.offset === this.target.size) return this.finish();
    let lastError: TaalcutError | undefined;
    for (const url of this.target.urls) {
      const outcome = await this.fromMirror(url);
      if (outcome.kind === 'complete') return this.finish();
      if (outcome.kind === 'stop') return err(outcome.error);
      lastError = outcome.error;
    }
    return err(lastError ?? DownloadFailed({ component: this.target.label }));
  }

  /** A verified file left by a run that crashed before installing it. */
  private async reuseFinishedFile(): Promise<DownloadResult | undefined> {
    const size = await fileSize(this.finalPath);
    if (size === undefined) return undefined;
    if (size === this.target.size) {
      const hash = createHash('sha256');
      this.emit('verifying', 0);
      await hashFileInto(hash, this.finalPath, {
        signal: this.options.signal,
        onBytes: (n) => this.emit('verifying', n),
      });
      if (hash.digest('hex') === this.target.sha256) {
        return { path: this.finalPath, resumedFrom: size, bytesFetched: 0 };
      }
    }
    await removeQuietly(this.finalPath);
    return undefined;
  }

  /** Picks up a partial file whose saved state matches this target; anything else is discarded. */
  private async loadPart(): Promise<void> {
    const meta = await readPartMeta(this.partPath);
    const size = await fileSize(this.partPath);
    const usable =
      meta !== undefined &&
      size !== undefined &&
      meta.sha256 === this.target.sha256 &&
      meta.size === this.target.size &&
      size <= this.target.size;
    if (!usable) {
      await discardPart(this.partPath);
      return;
    }
    this.emit('checking', 0);
    this.offset = await hashFileInto(this.hash, this.partPath, {
      signal: this.options.signal,
      onBytes: (n) => this.emit('checking', n),
    });
    this.meta = meta;
    this.resumedFrom = this.offset;
  }

  private async fromMirror(url: string): Promise<Outcome> {
    let failures = 0;
    for (;;) {
      const outcome = await this.attempt(url);
      if (outcome.kind !== 'retry') return outcome;
      if (outcome.immediate) continue;
      failures = outcome.progressed ? 1 : failures + 1;
      if (failures >= this.retry.maxAttempts) return { kind: 'next-mirror', error: outcome.error };
      const delay = backoffDelay(this.retry, failures, this.options.random, outcome.retryAfterMs);
      this.options.onRetry?.({ attempt: failures, delayMs: delay, error: outcome.error });
      try {
        await (this.options.sleep ?? sleep)(delay, this.options.signal);
      } catch {
        return { kind: 'stop', error: CancelledError() };
      }
    }
  }

  private async attempt(url: string): Promise<Outcome> {
    const signal = this.options.signal;
    if (signal?.aborted) return { kind: 'stop', error: CancelledError() };
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timedOut = { by: undefined as 'headers' | 'stall' | undefined };
    const headers = requestHeaders(this.requestState(url));
    const headersTimer = setTimeout(() => {
      timedOut.by = 'headers';
      controller.abort();
    }, this.headersTimeoutMs);
    let response: Response;
    let fetched = url;
    try {
      // Redirects are followed here, so each Location is checked before anything connects to it.
      for (let hops = 0; ; hops++) {
        response = await this.options.fetch(fetched, {
          method: 'GET',
          headers,
          signal: combined,
          redirect: 'manual',
        });
        if (!isRedirectStatus(response.status)) break;
        await response.body?.cancel().catch(() => undefined);
        const next = followRedirect(response, fetched, hops, this.target.label);
        if (!next.ok) return { kind: 'next-mirror', error: next.error };
        fetched = next.value;
      }
    } catch (cause) {
      return this.networkFailure(cause, timedOut.by, false);
    } finally {
      clearTimeout(headersTimer);
    }
    try {
      return await this.receive(url, fetched, response, controller, timedOut);
    } catch (cause) {
      // Network errors are handled inside receive(); what reaches here is the filesystem.
      return { kind: 'stop', error: this.localError(cause) };
    } finally {
      // Releases the connection if we stopped before the end of the body.
      await response.body?.cancel().catch(() => undefined);
    }
  }

  private async receive(
    url: string,
    fetchedUrl: string,
    response: Response,
    controller: AbortController,
    timedOut: { by: 'headers' | 'stall' | undefined },
  ): Promise<Outcome> {
    const verdict = classifyResponse(response, { ...this.requestState(url), fetchedUrl });
    if (verdict.kind === 'reject') return { kind: 'next-mirror', error: verdict.error };
    if (verdict.kind === 'retry') return { ...verdict, progressed: false };
    if (verdict.kind === 'restart') {
      await this.restartFromZero();
      return { kind: 'retry', error: verdict.error, progressed: false, immediate: verdict.immediate };
    }
    if (verdict.fromZero && this.offset > 0) await this.restartFromZero();
    const { etag, lastModified } = verdict;
    await this.saveMeta({
      v: 1,
      url,
      size: this.target.size,
      sha256: this.target.sha256,
      etag,
      lastModified,
    });
    return this.streamBody(response, controller, timedOut);
  }

  private requestState(url: string): RequestState {
    return { url, offset: this.offset, meta: this.meta, label: this.target.label, size: this.target.size };
  }

  private async streamBody(
    response: Response,
    controller: AbortController,
    timedOut: { by: 'headers' | 'stall' | undefined },
  ): Promise<Outcome> {
    const component = this.target.label;
    if (!response.body) return this.networkFailure(new Error('response has no body'), undefined, false);
    let handle: FileHandle;
    try {
      handle = await open(this.partPath, 'a');
      // The file must hold exactly the bytes in the hash, even after a failed write.
      await handle.truncate(this.offset);
    } catch (cause) {
      return { kind: 'stop', error: this.localError(cause) };
    }
    const stallTimer = setTimeout(() => {
      timedOut.by = 'stall';
      controller.abort();
    }, this.stallTimeoutMs);
    let received = 0;
    try {
      for await (const chunk of response.body) {
        stallTimer.refresh();
        if (this.offset + chunk.length > this.target.size) {
          await discardPart(this.partPath);
          this.resetHash();
          const actualBytes = this.offset + chunk.length;
          return {
            kind: 'next-mirror',
            error: SizeMismatch({ component, expectedBytes: this.target.size, actualBytes }),
          };
        }
        try {
          await writeAll(handle, chunk);
        } catch (cause) {
          return { kind: 'stop', error: this.localError(cause) };
        }
        this.hash.update(chunk);
        this.offset += chunk.length;
        received += chunk.length;
        this.bytesFetched += chunk.length;
        this.emit('downloading', this.offset);
      }
    } catch (cause) {
      return this.networkFailure(cause, timedOut.by, received > 0);
    } finally {
      clearTimeout(stallTimer);
      await handle.close().catch(() => undefined);
    }
    if (this.offset < this.target.size) {
      const detail = `connection closed at ${this.offset} of ${this.target.size} bytes`;
      return { kind: 'retry', error: DownloadFailed({ component }, { detail }), progressed: received > 0 };
    }
    return { kind: 'complete' };
  }

  private async finish(): AsyncResult<DownloadResult> {
    this.emit('verifying', this.target.size);
    const digest = this.hash.digest('hex');
    try {
      if (digest !== this.target.sha256) {
        await discardPart(this.partPath);
        const detail = `expected sha256 ${this.target.sha256}, got ${digest}`;
        return err(ChecksumMismatch({ component: this.target.label }, { detail }));
      }
      await rename(this.partPath, this.finalPath);
      await removeQuietly(metaPathFor(this.partPath));
    } catch (cause) {
      return err(this.localError(cause));
    }
    return ok({ path: this.finalPath, resumedFrom: this.resumedFrom, bytesFetched: this.bytesFetched });
  }

  private networkFailure(
    cause: unknown,
    timedOutBy: 'headers' | 'stall' | undefined,
    progressed: boolean,
  ): Outcome {
    if (this.options.signal?.aborted) return { kind: 'stop', error: CancelledError() };
    const detail =
      timedOutBy === 'headers'
        ? `no response within ${this.headersTimeoutMs} ms`
        : timedOutBy === 'stall'
          ? `no data for ${this.stallTimeoutMs} ms`
          : describeCause(cause);
    return { kind: 'retry', error: DownloadFailed({ component: this.target.label }, { detail }), progressed };
  }

  /** Filesystem trouble. A full disk mid-download is the same plain error as the check before it. */
  private localError(cause: unknown): TaalcutError {
    const component = this.target.label;
    if (this.options.signal?.aborted) return CancelledError();
    if (isErrnoException(cause, 'ENOSPC')) {
      const requiredBytes = this.target.size - this.offset;
      return DiskSpaceLow({ component, requiredBytes, availableBytes: 0 }, { detail: describeCause(cause) });
    }
    return InstallFailed({ component }, { detail: describeCause(cause) });
  }

  private async restartFromZero(): Promise<void> {
    await discardPart(this.partPath);
    this.meta = undefined;
    this.resetHash();
  }

  private resetHash(): void {
    this.hash = createHash('sha256');
    this.offset = 0;
  }

  private async saveMeta(meta: PartMeta): Promise<void> {
    await writePartMeta(this.partPath, meta);
    this.meta = meta;
  }

  private emit(phase: DownloadPhase, bytesDone: number): void {
    this.options.onBytes?.(phase, bytesDone, this.target.size);
  }
}
