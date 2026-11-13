// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A cache of files named by their sha256 (tools/components/.cache/sha256/<hex>), so a release never downloads the
 * same bytes twice and nothing reads a download before its size and sha256 match the pin. A download that stalls,
 * is cut off or meets a transient error (a 5xx, 408, 429, a reset, a timeout) is retried with backoff and resumed
 * from the bytes it has (Range with If-Range); a 403, 404 or any other refusal fails at once. Node built-ins only.
 */
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { sha256File } from './files.mjs';

export const DEFAULT_CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'sha256');

const SHA256 = /^[0-9a-f]{64}$/;

export function cachePath(cacheDir, sha256) {
  if (!SHA256.test(sha256)) throw new Error(`not a sha256: ${sha256}`);
  return join(cacheDir, sha256);
}

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Checks `path` against the pin; throws with both sides when it doesn't match. */
export async function checkPin(path, pin, label) {
  const { size } = await stat(path);
  if (pin.size !== undefined && size !== pin.size)
    throw new Error(`${label}: ${size} bytes, the pin says ${pin.size}`);
  const sha = await sha256File(path);
  if (sha !== pin.sha256) throw new Error(`${label}: sha256 ${sha}, the pin says ${pin.sha256}`);
}

/** The cached copy of `pin.sha256`, or undefined. */
export async function cached(cacheDir, sha256) {
  const path = cachePath(cacheDir, sha256);
  return (await exists(path)) ? path : undefined;
}

/** Adds a local file to the cache under its own sha256 (checked against `pin` when given) and returns its path. */
export async function addToCache(cacheDir, file, pin) {
  const sha256 = pin?.sha256 ?? (await sha256File(file));
  if (pin) await checkPin(file, pin, file);
  const path = cachePath(cacheDir, sha256);
  if (await exists(path)) return path;
  await mkdir(cacheDir, { recursive: true });
  const part = `${path}.part-${process.pid}`;
  await copyFile(file, part);
  await rename(part, path);
  return path;
}

/** How a download behaves; each can be overridden per call (the tests shorten the waits). */
export const DOWNLOAD_DEFAULTS = {
  attempts: 6,
  backoffMs: 1_000,
  maxBackoffMs: 30_000,
  /** No byte (or no response) for this long aborts the attempt. */
  timeoutMs: 60_000,
  sleep: (ms) => delay(ms),
};

class Refused extends Error {}
class Transient extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

const transientStatus = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

/** Retry-After as milliseconds (seconds or an HTTP date), or undefined. */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

const reason = (error) =>
  error instanceof Error
    ? `${error.message}${error.cause ? ` (${error.cause.message ?? error.cause})` : ''}`
    : String(error);

/**
 * One request for the rest of `pin` into `part`, which holds `state.bytes` bytes: a range from there when there are
 * any (If-Range on the validator the first response gave), else the whole file. Throws Refused or Transient.
 */
async function attempt(pin, part, state, { fetch, timeoutMs }) {
  const from = state.bytes;
  const headers = { 'accept-encoding': 'identity' };
  if (from > 0) {
    headers.range = `bytes=${from}-`;
    if (state.validator) headers['if-range'] = state.validator;
  }
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(`no data for ${timeoutMs} ms`)), timeoutMs);
  };
  arm();
  let file;
  try {
    let response;
    try {
      response = await fetch(pin.url, { redirect: 'follow', headers, signal: controller.signal });
    } catch (error) {
      throw new Transient(reason(controller.signal.reason ?? error));
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const message = `${pin.url}: HTTP ${response.status}`;
      if (from > 0 && response.status === 416) {
        state.bytes = 0;
        throw new Transient(`${message} for bytes ${from}-; starting again`);
      }
      if (!transientStatus(response.status)) throw new Refused(message);
      throw new Transient(message, retryAfterMs(response.headers.get('retry-after')));
    }
    const resumed = from > 0 && response.status === 206;
    if (resumed) {
      const start = /^bytes (\d+)-/.exec(response.headers.get('content-range') ?? '')?.[1];
      if (Number(start) !== from) {
        await response.body?.cancel().catch(() => {});
        state.bytes = 0;
        throw new Transient(
          `${pin.url}: asked for bytes ${from}-, got ${response.headers.get('content-range')}`,
        );
      }
      state.resumed = true;
    } else {
      state.bytes = 0;
      state.validator = response.headers.get('etag') ?? response.headers.get('last-modified') ?? undefined;
    }
    if (!response.body) throw new Transient(`${pin.url}: no body`);
    const limit = pin.encoding ? undefined : pin.size;
    file = await open(part, resumed ? 'a' : 'w');
    for await (const chunk of response.body) {
      arm();
      await file.write(chunk);
      state.bytes += chunk.length;
      if (limit !== undefined && state.bytes > limit)
        throw new Refused(`${pin.url}: more than the ${limit} bytes the pin says`);
    }
  } catch (error) {
    if (error instanceof Refused || error instanceof Transient) throw error;
    throw new Transient(`${pin.url}: ${reason(controller.signal.reason ?? error)}`);
  } finally {
    clearTimeout(timer);
    await file?.close();
  }
}

/** Downloads `pin` into `part`, retrying transient failures with backoff and resuming. Returns what it did. */
async function download(pin, part, options) {
  const { attempts, backoffMs, maxBackoffMs, sleep, log } = options;
  const state = { bytes: 0, validator: undefined, resumed: false };
  for (let n = 1; ; n++) {
    try {
      await attempt(pin, part, state, options);
      return state;
    } catch (error) {
      if (error instanceof Refused) throw error;
      if (n >= attempts)
        throw new Error(`${error.message} (gave up after ${attempts} attempts)`, { cause: error });
      const wait = Math.min(maxBackoffMs, error.retryAfterMs ?? backoffMs * 2 ** (n - 1));
      const at = state.bytes > 0 ? `, resuming at byte ${state.bytes}` : '';
      log(`${error.message}; attempt ${n + 1} of ${attempts} in ${wait} ms${at}`);
      await sleep(wait);
    }
  }
}

/**
 * The file `pin` names ({ url, sha256, size?, encoding? }), from the cache or downloaded into it. `encoding:
 * 'base64'` is for a server that sends the file base64-encoded (gitiles' ?format=TEXT); the pin is the decoded
 * bytes'. A download that doesn't match is deleted and throws; one that was resumed is fetched once more whole
 * before that, since a resume is the one way this code could have joined the wrong bytes.
 */
export async function pinned(pin, options = {}) {
  const { cacheDir = DEFAULT_CACHE, fetch = globalThis.fetch, log = () => {}, ...rest } = options;
  const settings = { ...DOWNLOAD_DEFAULTS, ...rest, fetch, log };
  const hit = await cached(cacheDir, pin.sha256);
  if (hit) return hit;
  await mkdir(cacheDir, { recursive: true });
  const part = `${cachePath(cacheDir, pin.sha256)}.part-${process.pid}`;
  log(`download ${pin.url}`);
  try {
    for (let whole = false; ; whole = true) {
      const state = await download(pin, part, settings);
      if (pin.encoding === 'base64')
        await writeFile(part, Buffer.from((await readFile(part, 'utf8')).replace(/\s+/g, ''), 'base64'));
      try {
        await checkPin(part, pin, pin.url);
        break;
      } catch (error) {
        if (!state.resumed || whole) throw error;
        log(`${error.message}; downloading it again from the start`);
        await rm(part, { force: true });
      }
    }
    const path = cachePath(cacheDir, pin.sha256);
    await rename(part, path);
    return path;
  } finally {
    await rm(part, { force: true });
  }
}
