// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The download of everything this Mac needs (packages/jobs' download set) as a window sees it (core's
 * `Downloads`, UX2-DOWNLOADER): each component named for its job, its state, step, progress and last failure,
 * and the set's counts, bytes, speed and time left.
 */
import type {
  Component,
  ComponentJob,
  Downloads,
  DownloadStep,
  ModelModuleId,
  PublicError,
  TaalcutError,
} from '@taalcut/core';
import type {
  AwaitingTerms,
  ComponentProgress,
  ComponentStatus,
  DownloadSetEntry,
  DownloadSetStatus,
} from '@taalcut/jobs';

/**
 * The job each component does (tools/components ids), which names its row: "Speech", "Search"… A runtime several
 * jobs share counts toward the first that needs it (ONNX Runtime toward search). Tools fetched on demand have none.
 */
const JOB: Readonly<Record<string, ComponentJob>> = {
  'whisper-cpp': 'speech',
  'whisper-server': 'speech',
  'whisper-server-cuda': 'speech',
  'whisper-tiny': 'speech',
  'whisper-small-q8-0': 'speech',
  'whisper-medium-q5-0': 'speech',
  'silero-vad': 'speech',
  // LIB1-LANG: the Indian-language identifier (Odia and other Indian languages).
  'anuvani-lid': 'speech',
  onnxruntime: 'search',
  'onnxruntime-cuda': 'search',
  // Shared by search (ONNX Runtime's CUDA provider), speech and writing: it counts toward the first.
  'cuda-runtime-13': 'search',
  'embeddinggemma-2': 'search',
  'embeddinggemma-2-coreml': 'search',
  'ppocr-v5-devanagari': 'text',
  'ppocr-v5-latin': 'text',
  transnetv2: 'shots',
  'transnetv2-coreml': 'shots',
  'beat-this': 'beats',
  'local-llm-runtime': 'writing',
  'local-llm-runtime-cuda': 'writing',
  'local-llm-runtime-vulkan': 'writing',
  'local-llm-qwen3-5-4b': 'writing',
  'local-llm-qwen3-5-4b-mmproj': 'writing',
  'local-llm-qwen3-5-0-8b': 'writing',
  'hyperframes-headless-shell': 'titles',
  'sfx-pack': 'sounds',
};

export const jobOf = (id: string): ComponentJob | undefined => JOB[id];

/** The window never sees `detail`: developer text that may quote a URL or a path. */
export function publicError({ code, messageKey, params, retryable, fix }: TaalcutError): PublicError {
  return {
    code,
    messageKey,
    retryable,
    ...(params === undefined ? {} : { params }),
    ...(fix === undefined ? {} : { fix }),
  };
}

/** Which part of its download a component is in. */
export function stepOf(progress: ComponentProgress): DownloadStep {
  if (progress.retry) return 'reconnecting';
  switch (progress.phase) {
    case 'checking':
      // Re-reading a partial file it picks up from; with nothing on disk it is about to download.
      return progress.bytesTotal > 0 ? 'resuming' : 'downloading';
    case 'downloading':
      return 'downloading';
    case 'verifying':
      return 'verifying';
    case 'extracting':
    case 'installing':
      return 'installing';
  }
}

/** A running install's place: the fraction, its step, the bytes so far, the speed and time left once known. */
export function pace(progress: ComponentProgress | undefined, bytesDone: number): Partial<Component> {
  if (!progress) return { progress: 0, step: 'downloading', ...(bytesDone > 0 ? { bytesDone } : {}) };
  const retryAt = progress.retry?.at;
  return {
    progress: progress.fraction,
    step: stepOf(progress),
    bytesDone,
    ...(progress.phase === 'downloading' ? { bytesPerSecond: progress.bytesPerSecond } : {}),
    ...(progress.etaSeconds === undefined ? {} : { etaMs: progress.etaSeconds * 1000 }),
    ...(retryAt === undefined ? {} : { retryAt: Math.round(retryAt) }),
  };
}

/**
 * Its owner's terms (LNX1-TRM: the manifest's `licence.acceptance`), with whether the person accepted this version,
 * for the card that asks and the row that says whose it is. Nothing for every other component.
 */
function termsOf(status: ComponentStatus, accepted: boolean): Pick<Component, 'terms'> {
  const acceptance = status.licence.acceptance;
  if (!acceptance) return {};
  const documents = acceptance.documents.map(({ title, url }) => ({ title, url }));
  return { terms: { owner: acceptance.owner, termsVersion: acceptance.termsVersion, documents, accepted } };
}

/**
 * What every row says about a component, whatever its state. `accepted`: whether the person accepted its owner's
 * terms, for a component that states some (one in the download set has: the set holds it back otherwise).
 */
export function componentBase(
  status: ComponentStatus,
  usedBy: readonly ModelModuleId[],
  accepted = true,
): Omit<Component, 'status'> {
  const job = jobOf(status.id);
  return {
    id: status.id,
    name: status.name,
    version: status.version,
    licence: status.licence.spdx,
    // An installed version has its verified licence notice in its folder: Settings links it (round 3).
    ...(status.installed ? { notice: true } : {}),
    sizeBytes: status.downloadBytes ?? status.installed?.bytes ?? 0,
    usedBy: [...usedBy],
    ...(job ? { job } : {}),
    ...termsOf(status, accepted),
  };
}

const STATUS_OF: Record<DownloadSetEntry['state'], Component['status']> = {
  installed: 'installed',
  downloading: 'downloading',
  queued: 'queued',
  paused: 'paused',
  failed: 'failed',
  update: 'update-available',
  missing: 'not-installed',
};

/** A component this Mac needs, as the download set sees it. */
export function fromEntry(entry: DownloadSetEntry, usedBy: readonly ModelModuleId[]): Component {
  const base = {
    ...componentBase(entry.status, usedBy),
    needed: true,
    status: STATUS_OF[entry.state],
    ...(entry.needs.length > 0 ? { needs: [...entry.needs] } : {}),
  };
  if (entry.state === 'installed') return base;
  if (entry.state === 'downloading') return { ...base, ...pace(entry.progress, entry.bytesDone) };
  const partial = entry.bytesDone > 0 ? { bytesDone: entry.bytesDone } : {};
  return { ...base, ...partial, ...(entry.error ? { error: publicError(entry.error) } : {}) };
}

/** A component the set holds back until the person accepts its owner's terms (LNX1-TRM), and what it brings in. */
function heldBack({ status, unlocks }: AwaitingTerms, usedBy: readonly ModelModuleId[]) {
  const component: Component = { ...componentBase(status, usedBy, false), status: 'not-installed' };
  return { component, unlocks: [...unlocks] };
}

/** The set as `system.downloads` and the `components.downloads` event carry it. */
export function downloadsReport(
  set: DownloadSetStatus,
  usedBy: (id: string) => readonly ModelModuleId[],
): Downloads {
  const components = set.entries.map((entry) => fromEntry(entry, usedBy(entry.status.id)));
  const count = (...statuses: Component['status'][]) =>
    components.filter((each) => statuses.includes(each.status)).length;
  return {
    state: set.state,
    components,
    counts: {
      installed: count('installed'),
      downloading: count('downloading'),
      queued: count('queued'),
      paused: count('paused'),
      failed: count('failed'),
      missing: count('not-installed', 'update-available'),
    },
    bytesTotal: set.bytesTotal,
    bytesDone: set.bytesDone,
    bytesPerSecond: set.bytesPerSecond,
    ...(set.etaSeconds === undefined ? {} : { etaMs: set.etaSeconds * 1000 }),
    requiredBytes: set.requiredBytes,
    ...(set.availableBytes === undefined ? {} : { freeBytes: set.availableBytes }),
    ...(set.error ? { error: publicError(set.error) } : {}),
    ...(set.awaitingTerms.length > 0
      ? { awaitingTerms: set.awaitingTerms.map((held) => heldBack(held, usedBy(held.status.id))) }
      : {}),
  };
}
