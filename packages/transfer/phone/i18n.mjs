// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Catalog files are served from the phone origin as /assets/<locale>.json
 * (en, hi, es, pt-BR, and the en-XA pseudo-locale).
 */
const CANONICAL = new Map([
  ['en', 'en'],
  ['hi', 'hi'],
  ['es', 'es'],
  ['pt-br', 'pt-BR'],
  ['en-xa', 'en-XA'],
]);

const TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * Pick the first catalog that exists for `languages` (navigator.languages).
 * Falls back to English. `fetchJson` receives `/assets/<locale>.json` and
 * either returns the catalog object or throws when that file is missing.
 */
export async function loadCatalog(languages, fetchJson) {
  const seen = new Set();
  for (const tag of [...languageList(languages), 'en']) {
    for (const code of candidates(tag)) {
      if (seen.has(code)) continue;
      seen.add(code);
      try {
        const messages = await fetchJson(`/assets/${code}.json`);
        if (!messages || typeof messages !== 'object' || Array.isArray(messages)) continue;
        return withLocale(messages, code);
      } catch (error) {
        void error;
      }
    }
  }
  return withLocale({}, 'en');
}

/** Replace `{name}` placeholders. Missing names stay as written. Unknown keys return the key. */
export function translate(catalog, key, values) {
  const table = messagesOf(catalog);
  const template = typeof table[key] === 'string' ? table[key] : String(key ?? '');
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name) || values[name] == null) return token;
    return String(values[name]);
  });
}

function languageList(languages) {
  if (typeof languages === 'string') return [languages];
  if (!Array.isArray(languages)) return [];
  return languages.filter((tag) => typeof tag === 'string');
}

function candidates(tag) {
  const raw = String(tag).trim().replace(/_/g, '-');
  if (!TAG.test(raw)) return [];
  const lower = raw.toLowerCase();
  const exact = CANONICAL.get(lower) ?? raw;
  const list = [exact];
  const primary = lower.split('-')[0] ?? '';
  if (primary === 'pt' && exact !== 'pt-BR') list.push('pt-BR');
  const primaryCode = CANONICAL.get(primary);
  if (primary !== 'pt' && primaryCode && primaryCode !== exact) list.push(primaryCode);
  return list;
}

function messagesOf(catalog) {
  if (!catalog || typeof catalog !== 'object') return {};
  if (catalog.messages && typeof catalog.messages === 'object' && !Array.isArray(catalog.messages)) {
    return catalog.messages;
  }
  return catalog;
}

function withLocale(messages, locale) {
  const catalog = { ...messages };
  Object.defineProperty(catalog, 'locale', { value: locale, enumerable: false });
  return catalog;
}

export const labelKey = Object.freeze({
  pageTitle: 'page.title',
  stepsLabel: 'steps.label',
  stepPair: 'step.pair',
  stepChoose: 'step.choose',
  stepSend: 'step.send',
  stepDone: 'step.done',
  footNote: 'foot.note',
  pairTitle: 'pair.title',
  pairTitleAgain: 'pair.titleAgain',
  pairLede: 'pair.lede',
  pairLedeCode: 'pair.ledeCode',
  pairExpired: 'pair.expired',
  pairLedeApprove: 'pair.ledeApprove',
  pairExpiredApprove: 'pair.expiredApprove',
  approvalWaiting: 'approval.waiting',
  approvalMatch: 'approval.match',
  approvalDenied: 'approval.denied',
  approvalExpired: 'approval.expired',
  approvalBusy: 'approval.busy',
  approvalRefused: 'approval.refused',
  approvalAgain: 'approval.again',
  approvalUsePin: 'approval.usePin',
  codeLabel: 'code.label',
  codeHint: 'code.hint',
  pinLabel: 'pin.label',
  pinHint: 'pin.hint',
  pinDigit: 'pin.digit',
  pairSubmit: 'pair.submit',
  pairWorking: 'pair.working',
  pairDone: 'pair.done',
  pairErrorInvalid: 'pair.error.invalid',
  pairErrorCode: 'pair.error.code',
  pairErrorRejected: 'pair.error.rejected',
  pairErrorNetwork: 'pair.error.network',
  pairErrorRate: 'pair.error.rate',
  pairErrorClosed: 'pair.error.closed',
  pairErrorFull: 'pair.error.full',
  pairHelp: 'pair.help',
  chooseTitle: 'choose.title',
  chooseLede: 'choose.lede',
  chooseLedeIos: 'choose.ledeIos',
  chooseSending: 'choose.sending',
  chooseSeeProgress: 'choose.seeProgress',
  chooseFinished: 'choose.finished',
  chooseSeeDone: 'choose.seeDone',
  pickFiles: 'pick.files',
  pickFilesNote: 'pick.filesNote',
  pickPhotos: 'pick.photos',
  pickPhotosNote: 'pick.photosNote',
  pickAny: 'pick.any',
  pickAnyNote: 'pick.anyNote',
  guideTitle: 'guide.title',
  guideStep1: 'guide.step1',
  guideStep2: 'guide.step2',
  guideStep3: 'guide.step3',
  pageKeepOpen: 'page.keepOpen',
  sendTitle: 'send.title',
  sendMore: 'send.more',
  summaryCount: 'summary.count',
  summaryLeft: 'summary.left',
  fileProgress: 'file.progress',
  fileMeter: 'file.meter',
  fileMeterSpeed: 'file.meterSpeed',
  filePause: 'file.pause',
  fileResume: 'file.resume',
  fileStop: 'file.stop',
  fileRemove: 'file.remove',
  fileRetry: 'file.retry',
  fileAgain: 'file.again',
  stateWaiting: 'state.waiting',
  stateSending: 'state.sending',
  statePaused: 'state.paused',
  stateHeld: 'state.held',
  stateReceived: 'state.received',
  stateAdding: 'state.adding',
  stateAdded: 'state.added',
  stateAlready: 'state.already',
  stateSmallerCopy: 'state.smallerCopy',
  stateFailed: 'state.failed',
  stateRejected: 'state.rejected',
  stateCancelled: 'state.cancelled',
  stateCancelledMac: 'state.cancelledMac',
  stateGhost: 'state.ghost',
  stateUnknown: 'state.unknown',
  reasonPaused: 'reason.paused',
  reasonGhost: 'reason.ghost',
  errorUnauthorized: 'error.unauthorized',
  errorForbidden: 'error.forbidden',
  errorTooLarge: 'error.tooLarge',
  errorNotMedia: 'error.notMedia',
  errorDiskFull: 'error.diskFull',
  errorNetwork: 'error.network',
  errorGeneric: 'error.generic',
  errorImportFailed: 'error.importFailed',
  doneTitle: 'done.title',
  doneTitleSome: 'done.titleSome',
  doneLede: 'done.lede',
  doneLedeSome: 'done.ledeSome',
  doneArrived: 'done.arrived',
  doneNotSent: 'done.notSent',
  doneMore: 'done.more',
  lostTitle: 'lost.title',
  lostBody: 'lost.body',
  lostRetry: 'lost.retry',
  lostTrying: 'lost.trying',
  waitingTitle: 'waiting.title',
  waitingBody: 'waiting.body',
  waitingCheck: 'waiting.check',
  waitingChecking: 'waiting.checking',
});

export const LABEL_KEYS = Object.freeze(Object.values(labelKey));

const STATE_KEYS = {
  waiting: labelKey.stateWaiting,
  sending: labelKey.stateSending,
  uploading: labelKey.stateSending,
  paused: labelKey.statePaused,
  held: labelKey.stateHeld,
  received: labelKey.stateReceived,
  checking: labelKey.stateAdding,
  importing: labelKey.stateAdding,
  added: labelKey.stateAdded,
  imported: labelKey.stateAdded,
  duplicate: labelKey.stateAlready,
  failed: labelKey.stateFailed,
  rejected: labelKey.stateRejected,
  cancelled: labelKey.stateCancelled,
  ghost: labelKey.stateGhost,
  'smaller-copy': labelKey.stateSmallerCopy,
  likely: labelKey.stateSmallerCopy,
};

export function stateLabelKey(state) {
  if (typeof state === 'string' && Object.prototype.hasOwnProperty.call(STATE_KEYS, state)) {
    return STATE_KEYS[state];
  }
  return labelKey.stateUnknown;
}

export function serverFailureLabel(error) {
  const code = error && typeof error === 'object' ? error.code : '';
  if (code === 'transfer.disk_full') return labelKey.errorDiskFull;
  if (code === 'transfer.too_large') return labelKey.errorTooLarge;
  if (code === 'transfer.not_media') return labelKey.errorNotMedia;
  if (code === 'transfer.import_failed') return labelKey.errorImportFailed;
  return '';
}

export function failureLabelKey(status) {
  if (status === 401) return labelKey.errorUnauthorized;
  if (status === 403) return labelKey.errorForbidden;
  if (status === 413) return labelKey.errorTooLarge;
  if (status === 415) return labelKey.errorNotMedia;
  if (status === 507) return labelKey.errorDiskFull;
  if (!status) return labelKey.errorNetwork;
  return labelKey.errorGeneric;
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];

export function formatBytes(bytes, locale) {
  const amount = Number(bytes);
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
  let unitIndex = 0;
  let value = safe;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const format = numberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[unitIndex],
    unitDisplay: unitIndex === 0 ? 'long' : 'short',
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  });
  return format.format(value);
}

function numberFormat(locale, options) {
  const tag = typeof locale === 'string' && locale ? locale : 'en';
  try {
    return new Intl.NumberFormat(tag, options);
  } catch (error) {
    void error;
    return new Intl.NumberFormat('en', options);
  }
}

export async function requestJson(fetchImpl, path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.credential) headers.Authorization = `Bearer ${options.credential}`;
  let payload;
  if (Object.prototype.hasOwnProperty.call(options, 'body')) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  let response;
  try {
    const init = { method: options.method ?? 'GET', headers, body: payload };
    // A request sent as the page goes away (withdrawing an approval request) has to outlive it.
    if (options.keepalive) init.keepalive = true;
    response = await fetchImpl(path, init);
  } catch (error) {
    void error;
    throw Object.assign(new Error('network'), { status: 0, network: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error('http'), {
      status: response.status,
      retryAfter: response.headers.get('Retry-After'),
    });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    void error;
    throw Object.assign(new Error('bad-json'), { status: 400 });
  }
}
