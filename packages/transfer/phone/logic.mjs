// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { failureLabelKey, serverFailureLabel } from './i18n.mjs';

export {
  failureLabelKey,
  formatBytes,
  labelKey,
  LABEL_KEYS,
  requestJson,
  serverFailureLabel,
  stateLabelKey,
} from './i18n.mjs';

export const CHUNK_SIZE = 32 * 1024 * 1024;
export const RETRY_DELAYS = Object.freeze([0, 1000, 3000, 5000, 10000, 20000, 30000]);

const FILES_ACCEPT = '.mov,.mp4,.m4v,.heic,.heif,.jpg,.jpeg,.png,.dng';
const MEDIA_ACCEPT = 'video/*,image/*';
const SKIP_STATES = new Set(['imported', 'duplicate', 'received']);
const RESUME_STATES = new Set(['uploading', 'paused']);

export function detectPlatform(userAgent) {
  const ua = String(userAgent ?? '');
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export function fileInputsFor(platform) {
  if (platform === 'ios') {
    return [
      { id: 'files', accept: FILES_ACCEPT, kind: 'files' },
      { id: 'photos', accept: MEDIA_ACCEPT, kind: 'photos' },
    ];
  }
  return [{ id: 'any', accept: MEDIA_ACCEPT, kind: 'any' }];
}

export function readTokenFromHash(hash) {
  const text = String(hash ?? '');
  const query = text.startsWith('#') ? text.slice(1) : text;
  if (!query) return null;
  const token = new URLSearchParams(query).get('k');
  return token ? token : null;
}

export function pairBody({ token, code, pin, name } = {}) {
  const pinText = pin == null ? '' : String(pin).trim();
  if (token) {
    const safeName = typeof name === 'string' ? name.trim().slice(0, 60) : '';
    return { token: String(token), pin: pinText, device: { name: safeName } };
  }
  const codeText = code == null ? '' : String(code).trim().toUpperCase();
  return { code: codeText, pin: pinText, device: {} };
}

export function deviceLabel(userAgent) {
  const ua = String(userAgent ?? '');
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  const model = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\))/i);
  const name = model?.[1]?.trim();
  if (name && name.length > 1) return name.slice(0, 60);
  if (/Android/i.test(ua)) return 'Android';
  return 'Phone';
}

export function shouldRetry({ status, isNetworkError }) {
  if (isNetworkError) return true;
  const code = typeof status === 'number' ? status : Number(status);
  if (!Number.isFinite(code)) return false;
  if (code === 423 || code === 429) return true;
  return code >= 500 && code !== 507;
}

export function retryDelayMs(attempt, retryAfterHeader) {
  const seconds = retryAfterSeconds(retryAfterHeader);
  if (seconds != null) return Math.round(seconds * 1000);
  const index = typeof attempt === 'number' && Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  return index < RETRY_DELAYS.length ? RETRY_DELAYS[index] : 30000;
}

export function fingerprint(file) {
  const source = file ?? {};
  return `${source.name ?? ''}\n${source.size ?? ''}\n${source.lastModified ?? ''}\n${source.type ?? ''}`;
}

export function lookupDecision(match) {
  if (!match || typeof match !== 'object') return 'upload';
  if (RESUME_STATES.has(match.state) && typeof match.uploadId === 'string' && match.uploadId) return 'resume';
  if (SKIP_STATES.has(match.state)) return 'skip';
  return 'upload';
}

export function resumeUploadUrl(match, origin) {
  if (lookupDecision(match) !== 'resume') return null;
  const explicit = absoluteHttpUrl(match.url || match.uploadUrl || match.location, origin);
  if (explicit) return explicit;
  if (typeof match.uploadId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(match.uploadId)) return null;
  return absoluteHttpUrl(`/files/${match.uploadId}`, origin);
}

const TAKE = new Set([
  'received',
  'checking',
  'importing',
  'imported',
  'duplicate',
  'rejected',
  'failed',
  'cancelled',
]);
const STOP = new Set(['failed', 'rejected', 'cancelled']);

export function validPair({ pin, code, hasToken }) {
  if (!/^\d{6}$/.test(String(pin ?? '').trim())) return false;
  if (hasToken) return true;
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(
    String(code ?? '')
      .trim()
      .toUpperCase(),
  );
}

export function readStoredSession(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved.credential !== 'string' || typeof saved.deviceId !== 'string') return null;
    if (!saved.credential || !saved.deviceId) return null;
    return { deviceId: saved.deviceId, credential: saved.credential };
  } catch (error) {
    void error;
    return null;
  }
}

export function fileRecord(file) {
  return {
    name: file?.name ?? '',
    size: file?.size ?? 0,
    lastModified: file?.lastModified ?? 0,
    type: file?.type || '',
  };
}

export function sameTransferFile(local, remote) {
  if (!local || !remote || remote.name !== local.name) return false;
  return (remote.sizeBytes ?? remote.size) === local.size;
}

export function lookupMatch(body) {
  const matches = body && Array.isArray(body.matches) ? body.matches : [];
  return matches.find((match) => match && (match.index === 0 || match.index == null)) ?? null;
}

export function remoteUpdate(remote) {
  if (!remote || typeof remote !== 'object') return null;
  const verdict = remote.reencode?.verdict === 'likely';
  if (!TAKE.has(remote.state)) return { verdict, apply: false };
  return {
    verdict,
    apply: true,
    state: remote.state,
    sent: typeof remote.receivedBytes === 'number' ? remote.receivedBytes : null,
    stop: STOP.has(remote.state),
    failKey: serverFailureLabel(remote.error),
  };
}

export function failureInfo(error) {
  const response = error && error.originalResponse;
  let status = 0;
  let isNetworkError = true;
  let retryAfter = null;
  if (response && typeof response.getStatus === 'function') {
    status = Number(response.getStatus()) || 0;
    isNetworkError = status === 0;
    retryAfter = typeof response.getHeader === 'function' ? response.getHeader('Retry-After') : null;
  } else if (error && typeof error.status === 'number') {
    status = error.status;
    isNetworkError = Boolean(error.network) || status === 0;
    retryAfter = error.retryAfter ?? null;
  }
  return {
    status,
    isNetworkError,
    retryAfter,
    retry: shouldRetry({ status, isNetworkError }),
    label: failureLabelKey(status),
  };
}

function retryAfterSeconds(header) {
  if (header == null || header === '') return null;
  const text = String(header).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const seconds = Number(text);
  return Number.isFinite(seconds) ? seconds : null;
}

function absoluteHttpUrl(value, origin) {
  if (typeof value !== 'string' || !value || typeof origin !== 'string' || !origin) return null;
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch (error) {
    void error;
    return null;
  }
}
