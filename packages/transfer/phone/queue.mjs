// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The files this visit is sending, as plain data. No DOM and no network: app.js runs the uploads and paints
// the rows; this module decides what each state means, what a row offers, what a reload keeps, and how the
// Mac's own view of the files (GET /api/session) updates them.
import { fileRecord, labelKey, remoteUpdate } from './logic.mjs';

/** Still on the phone's side: waiting, being sent, paused by the connection or by you, or lost to a reload. */
export const ON_THE_WAY = new Set(['waiting', 'sending', 'paused', 'held', 'ghost']);
/** All its bytes reached the Mac, which is adding it to the library. */
export const AT_THE_MAC = new Set(['received', 'checking', 'importing']);
export const ARRIVED = new Set(['imported', 'duplicate']);
export const NOT_SENT = new Set(['failed', 'rejected', 'cancelled']);
const KNOWN = new Set([...ON_THE_WAY, ...AT_THE_MAC, ...ARRIVED, ...NOT_SENT]);
/** Refusals no retry can change: the file itself is the problem. */
const FINAL_FAILURES = new Set([labelKey.errorNotMedia, labelKey.errorTooLarge]);
const SNAPSHOT_LIMIT = 500;

export function isActive(item) {
  return ON_THE_WAY.has(item.state) || AT_THE_MAC.has(item.state);
}

export function newItem(id, file) {
  return blank(id, file, fileRecord(file), 'waiting');
}

/** A row without its file: restored after a reload, or a file only the Mac told us about. */
export function ghostItem(id, record, state) {
  const item = blank(id, null, record, KNOWN.has(state) ? state : 'ghost');
  if (ON_THE_WAY.has(item.state)) item.state = 'ghost';
  return item;
}

function blank(id, file, record, state) {
  return {
    id,
    file,
    record,
    state,
    sent: 0,
    speed: 0,
    verdict: '',
    failKey: '',
    cancelledBy: '',
    uploadId: '',
    generation: 0,
    cancelWait: null,
    lastBytes: 0,
    lastAt: 0,
  };
}

/** The upload id at the end of a tus upload URL (`…/files/<id>`), or '' when the URL has none. */
export function uploadIdFromUrl(url) {
  const match = /\/files\/([A-Za-z0-9_-]{1,128})\/?$/.exec(String(url ?? ''));
  return match ? match[1] : '';
}

/** What a row offers, in order: pause and stop while sending, resume while paused by you, and so on. */
export function actionsFor(item) {
  switch (item.state) {
    case 'waiting':
    case 'ghost':
      return ['remove'];
    case 'sending':
      return ['pause', 'stop'];
    case 'paused':
      return ['stop'];
    case 'held':
      return ['resume', 'stop'];
    case 'failed':
      return item.file && !FINAL_FAILURES.has(item.failKey) ? ['retry'] : [];
    case 'cancelled':
      return item.file ? ['again'] : [];
    default:
      return [];
  }
}

/** Counts for the summary line and the done screen. Bytes left count only what the phone still has to send. */
export function summarize(items) {
  const totals = { total: 0, arrived: 0, notSent: 0, active: 0, onTheWay: 0, bytesLeft: 0 };
  for (const item of items) {
    totals.total += 1;
    if (ARRIVED.has(item.state)) totals.arrived += 1;
    if (NOT_SENT.has(item.state)) totals.notSent += 1;
    if (isActive(item)) totals.active += 1;
    if (ON_THE_WAY.has(item.state)) {
      totals.onTheWay += 1;
      totals.bytesLeft += Math.max(0, (item.record.size || 0) - (item.sent || 0));
    }
  }
  return totals;
}

/** What a reload keeps of the list: the files' details and where they got to, never the files themselves. */
export function snapshotOf(items) {
  return items.slice(-SNAPSHOT_LIMIT).map((item) => ({
    name: item.record.name,
    size: item.record.size,
    lastModified: item.record.lastModified,
    type: item.record.type,
    state: ON_THE_WAY.has(item.state) ? 'ghost' : item.state,
    verdict: item.verdict,
    failKey: item.failKey,
    cancelledBy: item.cancelledBy,
    uploadId: item.uploadId,
  }));
}

/** Rows from a snapshot, as ghosts where the file is needed again. Anything malformed is dropped. */
export function restoreItems(raw, firstId) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (const entry of raw.slice(0, SNAPSHOT_LIMIT)) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || !Number.isFinite(entry.size)) continue;
    const record = {
      name: entry.name,
      size: entry.size,
      lastModified: Number.isFinite(entry.lastModified) ? entry.lastModified : 0,
      type: typeof entry.type === 'string' ? entry.type : '',
    };
    const item = ghostItem(firstId + items.length, record, entry.state);
    item.verdict = entry.verdict === 'likely' ? 'likely' : '';
    item.failKey = typeof entry.failKey === 'string' ? entry.failKey : '';
    item.cancelledBy = entry.cancelledBy === 'mac' || entry.cancelledBy === 'you' ? entry.cancelledBy : '';
    item.uploadId = typeof entry.uploadId === 'string' ? entry.uploadId : '';
    items.push(item);
  }
  return items;
}

const sizeOf = (entry) => entry.sizeBytes ?? entry.size;
const sameFile = (record, remote) => record.name === remote.name && sizeOf(remote) === sizeOf(record);

/** A row waiting for its file again (after a reload) that `file` completes, or null. */
export function ghostFor(items, file) {
  const record = fileRecord(file);
  return items.find((item) => !item.file && item.state === 'ghost' && sameFile(item.record, record)) ?? null;
}

/**
 * Brings the rows in line with the Mac's list of this phone's files. A row follows the Mac's record of its
 * own upload (by upload id); a row without its file follows the newest record of a file with its name and
 * size. Files the Mac knows that no row shows (after a reload with storage blocked) come back as new rows.
 * Returns the rows that changed, the rows whose upload must stop (the Mac stopped or refused them), and the
 * records to add as rows.
 */
export function applyRemote(items, files) {
  const newestFirst = (Array.isArray(files) ? files : [])
    .filter((file) => file && typeof file === 'object' && typeof file.name === 'string')
    .slice()
    .sort((left, right) => String(right.id ?? '').localeCompare(String(left.id ?? '')));
  const changed = new Set();
  const halt = [];
  const used = new Set();
  for (const item of items) {
    const remote = item.uploadId
      ? newestFirst.find((file) => file.id === item.uploadId)
      : item.file
        ? null
        : newestFirst.find((file) => !used.has(file) && sameFile(item.record, file));
    if (!remote) continue;
    used.add(remote);
    if (!item.uploadId && typeof remote.id === 'string') item.uploadId = remote.id;
    if (follow(item, remote, halt)) changed.add(item);
  }
  const adopt = [];
  for (const remote of newestFirst) {
    if (used.has(remote) || items.some((item) => sameFile(item.record, remote))) continue;
    if (adopt.some((record) => sameFile(record, remote))) continue;
    adopt.push(remote);
  }
  return { changed, halt, adopt };
}

function follow(item, remote, halt) {
  const update = remoteUpdate(remote);
  if (!update) return false;
  let changed = false;
  if (update.verdict && item.verdict !== 'likely') {
    item.verdict = 'likely';
    changed = true;
  }
  if (!item.file && (remote.state === 'uploading' || remote.state === 'paused')) {
    if (typeof remote.receivedBytes === 'number') item.sent = remote.receivedBytes;
    return changed;
  }
  if (!update.apply || item.state === update.state) return changed;
  if (item.state === 'cancelled' && item.cancelledBy === 'you') return changed;
  item.state = update.state;
  if (update.sent != null) item.sent = update.sent;
  if (update.stop) {
    item.failKey = update.failKey || item.failKey || (update.state === 'failed' ? labelKey.errorGeneric : '');
    if (update.state === 'cancelled') item.cancelledBy = 'mac';
    halt.push(item);
  }
  return true;
}

/** A row the Mac told us about: its file is needed again unless the Mac already finished with it. */
export function adoptRemote(id, remote) {
  const record = { name: remote.name, size: remote.sizeBytes ?? remote.size ?? 0, lastModified: 0, type: '' };
  const item = ghostItem(id, record, remote.state);
  item.uploadId = typeof remote.id === 'string' ? remote.id : '';
  if (typeof remote.receivedBytes === 'number') item.sent = remote.receivedBytes;
  const update = remoteUpdate(remote);
  if (update?.verdict) item.verdict = 'likely';
  if (update?.stop) item.failKey = update.failKey || '';
  if (item.state === 'cancelled') item.cancelledBy = 'mac';
  return item;
}

/** The reason a row shows under its status, as a catalog key, or ''. */
export function reasonKeyFor(item) {
  if (item.state === 'paused') return labelKey.reasonPaused;
  if (item.state === 'ghost') return labelKey.reasonGhost;
  if (NOT_SENT.has(item.state) && item.state !== 'cancelled') return item.failKey || labelKey.errorGeneric;
  if (item.verdict === 'likely' && (ARRIVED.has(item.state) || AT_THE_MAC.has(item.state))) {
    return labelKey.stateSmallerCopy;
  }
  return '';
}
