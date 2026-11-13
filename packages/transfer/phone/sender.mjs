// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Runs the queue: one file at a time (TRANSFER_LIMITS.parallelPerDevice), each through transfer.mjs, and the
// row actions (pause, resume, stop, remove, try again). The queue's rules are queue.mjs's; this is the doing.
import { fileRecord } from './logic.mjs';
import { ghostFor, isActive, newItem, uploadIdFromUrl } from './queue.mjs';
import { runTransfer, terminateUpload } from './transfer.mjs';

/**
 * `host`: { state (items, credential, nextId), origin, tus(), api(path, options), isVisible(), listen(onChange),
 * changed() (a row's state moved: save and repaint), progressed(item) (bytes moved: repaint that row),
 * expired() (the Mac no longer knows this phone) }.
 */
export function createSender(host) {
  const { state } = host;
  let pumping = false;

  /** Adds picked files. A file that completes a row from before a reload fills that row instead. */
  function enqueue(files) {
    if (!state.credential || files.length === 0) return false;
    for (const file of files) {
      const ghost = ghostFor(state.items, file);
      if (ghost) {
        ghost.file = file;
        ghost.record = fileRecord(file);
        ghost.state = 'waiting';
        continue;
      }
      state.items.push(newItem(state.nextId, file));
      state.nextId += 1;
    }
    host.changed();
    void pump();
    return true;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const next = state.credential ? state.items.find((item) => item.state === 'waiting' && item.file) : null;
        if (!next) break;
        await send(next);
      }
    } finally {
      pumping = false;
    }
  }

  async function send(item) {
    const generation = item.generation;
    item.state = 'sending';
    item.failKey = '';
    host.changed();
    const setState = (next) => {
      item.state = next;
      host.changed();
    };
    await runTransfer({
      file: item.file,
      origin: host.origin,
      tus: host.tus(),
      credential: () => state.credential,
      api: host.api,
      isCurrent: () => item.generation === generation && Boolean(state.credential),
      isVisible: host.isVisible,
      listen: host.listen,
      setCancel: (cancel) => {
        item.cancelWait = cancel;
      },
      onUrl: (url) => {
        item.uploadId = uploadIdFromUrl(url);
      },
      onPause: () => setState('paused'),
      onProgress: (sent) => progress(item, generation, sent),
      onUnauthorized: () => host.expired(),
      onFailed: (key) => {
        item.failKey = key;
        item.speed = 0;
        setState('failed');
      },
      onReceived: () => {
        item.sent = item.record.size;
        item.speed = 0;
        if (isActive(item)) setState('received');
      },
      onSkip: (skipped, verdict) => {
        item.sent = item.record.size;
        item.verdict = verdict;
        setState(skipped);
      },
    });
  }

  /** Bytes moved: the speed is measured over at least half a second so the meter doesn't flicker. */
  function progress(item, generation, sent) {
    if (item.generation !== generation) return;
    const now = Date.now();
    const gap = item.lastAt ? (now - item.lastAt) / 1000 : 0;
    if (item.lastAt && gap >= 0.5) item.speed = Math.max(0, (sent - item.lastBytes) / gap);
    if (!item.lastAt || gap >= 0.5) {
      item.lastAt = now;
      item.lastBytes = sent;
    }
    item.sent = sent;
    if (item.state === 'sending') {
      host.progressed(item);
      return;
    }
    item.state = 'sending';
    host.changed();
  }

  /** Stops whatever this row's upload is doing; its callbacks are ignored from here on. */
  function halt(item) {
    item.generation += 1;
    item.cancelWait?.();
    item.cancelWait = null;
    item.speed = 0;
    item.lastAt = 0;
  }

  /** A row's button. Stopping also deletes the partial upload on the Mac; pausing keeps it to resume. */
  function act(item, action) {
    const uploadId = item.uploadId;
    halt(item);
    if (action === 'pause') item.state = 'held';
    if (action === 'resume') item.state = 'waiting';
    if (action === 'stop') {
      item.state = 'cancelled';
      item.cancelledBy = 'you';
      if (uploadId) {
        const url = new URL(`/files/${uploadId}`, host.origin).href;
        void terminateUpload(host.tus(), url, state.credential);
      }
    }
    if (action === 'remove') state.items = state.items.filter((entry) => entry !== item);
    if (action === 'retry' || action === 'again') {
      item.state = 'waiting';
      item.failKey = '';
      item.cancelledBy = '';
      item.uploadId = '';
      item.sent = 0;
    }
    host.changed();
    void pump();
  }

  /** The Mac forgot this phone: rows on their way go back to waiting (or need their file) until it pairs again. */
  function suspend() {
    for (const item of state.items) {
      if (item.state !== 'sending' && item.state !== 'paused') continue;
      halt(item);
      item.state = item.file ? 'waiting' : 'ghost';
    }
  }

  return { enqueue, pump, halt, act, suspend };
}
