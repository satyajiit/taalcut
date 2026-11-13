// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// One file's trip to the Mac: ask the Mac what it already has (lookup), then send the rest with tus-js-client.
// Pausing aborts the request and keeps the bytes on the Mac; stopping also deletes them (tus termination).
import { CHUNK_SIZE, RETRY_DELAYS, failureInfo, fileRecord, fingerprint, labelKey } from './logic.mjs';
import { lookupDecision, lookupMatch, resumeUploadUrl, retryDelayMs } from './logic.mjs';

/**
 * Runs one upload. `host` gives the file, the credential, the API and callbacks; `isCurrent()` turns false
 * once the page has paused, stopped or retried this file, and from then on nothing reports back.
 */
export async function runTransfer(host) {
  const meta = fileRecord(host.file);
  const match = await lookupUntilReady(host, meta);
  if (!match || !host.isCurrent()) return;
  if (match.skip) {
    host.onSkip(match.state, match.verdict);
    return;
  }
  const reason = await startTusUpload({
    ...host,
    meta,
    uploadUrl: match.uploadUrl,
    credential: host.credential(),
  });
  if (reason === 'missing') host.onFailed(labelKey.errorGeneric);
}

/** Deletes an unfinished upload on the Mac. Resolves to true when the Mac confirmed it. */
export async function terminateUpload(tus, url, credential) {
  const Upload = tus?.Upload;
  if (typeof Upload?.terminate !== 'function' || typeof url !== 'string' || !url) return false;
  return Upload.terminate(url, { headers: { Authorization: `Bearer ${credential}` } }).then(
    () => true,
    () => false,
  );
}

export function startTusUpload(host) {
  const Upload = host.tus?.Upload;
  if (typeof Upload !== 'function') return Promise.resolve('missing');
  return new Promise((resolve) => {
    let stopped = false;
    let retryAttempt = 0;
    let cancelRetry = () => {};
    const finish = (reason) => {
      if (stopped) return;
      stopped = true;
      cancelRetry();
      host.setCancel(() => {});
      resolve(reason);
    };
    const current = () => !stopped && host.isCurrent();
    const upload = new Upload(host.file, {
      endpoint: new URL('/files/', host.origin).href,
      uploadUrl: host.uploadUrl || null,
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS.slice(),
      storeFingerprintForResuming: false,
      headers: { Authorization: `Bearer ${host.credential}` },
      metadata: {
        filename: host.meta.name,
        filetype: host.meta.type,
        lastModified: String(host.meta.lastModified),
        fingerprint: fingerprint(host.meta),
      },
      onUploadUrlAvailable() {
        if (current() && upload.url) host.onUrl?.(upload.url);
      },
      onShouldRetry(error, attempt, options) {
        const info = failureInfo(error);
        if (!info.retry || !current()) return false;
        retryAttempt = attempt;
        if (!host.isVisible()) return false;
        options.retryDelays[attempt] = retryDelayMs(attempt, info.retryAfter);
        host.onPause();
        return true;
      },
      onProgress(sent) {
        if (current()) host.onProgress(sent);
      },
      onError(error) {
        if (!current()) return;
        const info = failureInfo(error);
        if (info.status === 401) {
          halt();
          host.onUnauthorized();
          return;
        }
        if (!info.retry) {
          host.onFailed(info.label, info.status);
          finish('failed');
          return;
        }
        const attempt = retryAttempt;
        retryAttempt = attempt + 1;
        host.onPause();
        const waiting = waitForRetry(retryDelayMs(attempt, info.retryAfter), host);
        cancelRetry = waiting.cancel;
        host.setCancel(waiting.cancel);
        void waiting.promise.then(() => {
          if (!current()) {
            finish('stopped');
            return;
          }
          host.setCancel(halt);
          upload.start();
        });
      },
      onSuccess() {
        if (!current()) return;
        host.onReceived();
        finish('received');
      },
    });
    // Aborting only stops the request: the bytes stay on the Mac, so a resume carries on from them.
    const halt = () => {
      const done = () => finish('aborted');
      void Promise.resolve()
        .then(() => upload.abort(false))
        .then(done, done);
    };
    host.setCancel(halt);
    upload.start();
  });
}

/** Waits `delay` ms, counting only while the page is visible (a hidden page retries once it is seen again). */
export function waitForRetry(delay, host) {
  let timer = 0;
  let settled = false;
  let unlisten = () => {};
  let resolvePromise = () => {};
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timer);
    unlisten();
    resolvePromise();
  };
  const arm = () => {
    timer = globalThis.setTimeout(finish, delay);
  };
  if (host.isVisible()) arm();
  else {
    unlisten = host.listen(() => {
      if (!host.isVisible()) return;
      unlisten();
      unlisten = () => {};
      arm();
    });
  }
  return { promise, cancel: finish };
}

async function lookupUntilReady(host, meta) {
  let attempt = 0;
  while (host.isCurrent()) {
    try {
      const body = await host.api('/api/uploads/lookup', { method: 'POST', body: { files: [meta] } });
      const found = lookupMatch(body);
      if (lookupDecision(found) === 'skip') {
        return {
          skip: true,
          state: found.state,
          verdict: found.reencode?.verdict === 'likely' ? 'likely' : '',
        };
      }
      const resume = lookupDecision(found) === 'resume';
      return { skip: false, uploadUrl: resume ? resumeUploadUrl(found, host.origin) : null };
    } catch (error) {
      const info = failureInfo(error);
      if (info.status === 401) {
        host.onUnauthorized();
        return null;
      }
      if (!info.retry || !host.isCurrent()) {
        if (host.isCurrent()) host.onFailed(info.label, info.status);
        return null;
      }
      host.onPause();
      const waiting = waitForRetry(retryDelayMs(attempt, info.retryAfter), host);
      host.setCancel(waiting.cancel);
      await waiting.promise;
      if (!host.isCurrent()) return null;
      attempt += 1;
    }
  }
  return null;
}
