// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the crash event that is sent from the one the SDK or main made (P2-X5). Only listed fields
 * survive: the message, the exception and its stack frames, release, environment, tags, Electron's
 * lifecycle breadcrumbs and the contexts in CONTEXT_FIELDS. Every string in them is scrubbed: secrets
 * (shapes from @taalcut/models, the keychain's values, credential-named environment variables) are
 * replaced, the home folder becomes `~`, other paths `<path:.ext>`, and the user and machine names
 * `<name>`. Stack frames inside the app keep their function name and path.
 */
import { scrubSecrets } from '@taalcut/models';
import { applyKnownSecrets, replaceHome, replaceMcpTokens, replaceNames, replacePaths } from './text-shapes';

const MESSAGE_LIMIT = 300;
const IN_APP = /app\.asar|(?:^|\/)out\/(?:main|utility|renderer|preload)\//;

/** Top-level fields a sent event may carry. The rest (user, request, extra, server_name, …) is dropped. */
const EVENT_FIELDS = ['event_id', 'timestamp', 'level', 'platform', 'release', 'dist', 'environment', 'sdk'];

/** The contexts a sent event may carry, and the fields kept in each: the consent line names them (Settings ›
 * Privacy). Locale, time zone, screen and memory are not among them. */
export const CONTEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  app: ['app_name', 'app_version', 'app_arch'],
  os: ['name', 'version', 'build', 'kernel_version'],
  runtime: ['name', 'version'],
  chrome: ['name', 'type', 'version'],
  node: ['name', 'type', 'version'],
  device: ['arch', 'family', 'cpu_description'],
  gpu: ['name', 'vendor_id', 'id', 'active'],
  trace: ['trace_id', 'span_id'],
  /** An unexpected utility exit (reporting.ts). */
  utility: ['name', 'code', 'stderr'],
  /** A run that ended without quitting, found at the next launch (last-run.ts). */
  last_run: ['version', 'started_at'],
};

/** Only Electron's lifecycle breadcrumbs (`app.ready`, `window.show`, …) are kept, without data. */
const CRUMB_CATEGORY = 'electron';
const CRUMB_FIELDS = ['timestamp', 'category', 'type', 'level', 'message'];
const FRAME_FIELDS = ['function', 'filename', 'abs_path', 'module', 'lineno', 'colno', 'in_app', 'platform'];

export interface ScrubOptions {
  readonly secrets?: readonly string[];
  readonly homeDir?: string;
  readonly appRoots?: readonly string[];
  /** The account's user name and the Mac's host names (scrub-sources.ts). */
  readonly names?: readonly string[];
}

type Row = Record<string, unknown>;

export function scrubCrashEvent<T>(event: T, options: ScrubOptions = {}): T {
  try {
    const source = structuredClone(event) as Row;
    const out: Row = pick(source, EVENT_FIELDS);
    const message = scrubMessage(source.message, options);
    if (message !== undefined) out.message = message;
    const logentry = scrubLogentry(source.logentry, options);
    if (logentry) out.logentry = logentry;
    const exception = scrubException(source.exception, options);
    if (exception) out.exception = exception;
    if (isRow(source.tags)) out.tags = scrubRecord(source.tags, options);
    const contexts = scrubContexts(source.contexts, options);
    if (contexts) out.contexts = contexts;
    const breadcrumbs = scrubBreadcrumbs(source.breadcrumbs, options);
    if (breadcrumbs.length > 0) out.breadcrumbs = breadcrumbs;
    return out as T;
  } catch (cause) {
    console.warn(`[crash] the event could not be scrubbed and was replaced: ${String(cause)}`);
    return { message: 'crash report scrub failed', level: 'error', platform: 'javascript' } as T;
  }
}

export function isInApp(filename: string, appRoots: readonly string[] = []): boolean {
  if (IN_APP.test(filename)) return true;
  return appRoots.some((root) => {
    if (root.length < 2) return false;
    const prefix = root.endsWith('/') ? root : `${root}/`;
    return filename === root || filename.startsWith(prefix);
  });
}

/** One stderr line, capped, for an unexpected utility exit. Not clipped to the message limit. */
export function scrubStderrLine(line: string, options: ScrubOptions = {}): string {
  const capped = line.length > 2000 ? line.slice(0, 2000) : line;
  return scrubText(capped, 'full', options);
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const field of fields) if (row[field] !== undefined) out[field] = row[field];
  return out;
}

function scrubException(value: unknown, options: ScrubOptions): Row | undefined {
  if (!isRow(value) || !Array.isArray(value.values)) return undefined;
  const values = value.values.filter(isRow).map((entry) => {
    const out: Row = {};
    if (typeof entry.type === 'string') out.type = scrubText(entry.type, 'secrets', options);
    if (typeof entry.value === 'string') out.value = clip(scrubText(entry.value, 'full', options));
    if (isRow(entry.mechanism)) out.mechanism = pick(entry.mechanism, ['type', 'handled']);
    const frames = isRow(entry.stacktrace) ? entry.stacktrace.frames : undefined;
    if (Array.isArray(frames))
      out.stacktrace = { frames: frames.filter(isRow).map((f) => scrubFrame(f, options)) };
    return out;
  });
  return { values };
}

function scrubFrame(frame: Row, options: ScrubOptions): Row {
  const out = pick(frame, FRAME_FIELDS);
  const filename = typeof out.filename === 'string' ? out.filename : out.abs_path;
  const keep = typeof filename === 'string' && filename.length > 0 && isInApp(filename, options.appRoots);
  if (typeof out.function === 'string') out.function = scrubText(out.function, 'secrets', options);
  if (typeof out.filename === 'string') out.filename = scrubPath(out.filename, keep, options);
  if (typeof out.abs_path === 'string') out.abs_path = scrubPath(out.abs_path, keep, options);
  if (!keep) delete out.module;
  else if (typeof out.module === 'string') out.module = scrubText(out.module, 'keep-path', options);
  return out;
}

function scrubBreadcrumbs(value: unknown, options: ScrubOptions): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRow).flatMap((crumb) => {
    if (crumb.category !== CRUMB_CATEGORY) return [];
    const out = pick(crumb, CRUMB_FIELDS);
    if (typeof out.message === 'string') out.message = clip(scrubText(out.message, 'full', options));
    return [out];
  });
}

function scrubContexts(value: unknown, options: ScrubOptions): Row | undefined {
  if (!isRow(value)) return undefined;
  const out: Row = {};
  for (const [key, fields] of Object.entries(CONTEXT_FIELDS)) {
    const context = value[key];
    if (!isRow(context)) continue;
    const kept = pick(context, fields);
    if (key === 'utility') {
      const stderr = kept.stderr;
      if (Array.isArray(stderr))
        kept.stderr = stderr
          .filter((line) => typeof line === 'string')
          .map((l) => scrubStderrLine(l, options));
      else if (typeof stderr === 'string') kept.stderr = scrubStderrLine(stderr, options);
      if (typeof kept.name === 'string') kept.name = scrubText(kept.name, 'full', options);
    } else {
      Object.assign(kept, scrubRecord(kept, options));
    }
    out[key] = kept;
  }
  return out;
}

function scrubRecord(record: Row, options: ScrubOptions): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(record)) out[key] = scrubUnknown(value, options);
  return out;
}

function scrubUnknown(value: unknown, options: ScrubOptions): unknown {
  if (typeof value === 'string') return scrubText(value, 'full', options);
  if (Array.isArray(value)) return value.map((item) => scrubUnknown(item, options));
  if (isRow(value)) return scrubRecord(value, options);
  return value;
}

function scrubMessage(value: unknown, options: ScrubOptions): unknown {
  if (typeof value === 'string') return clip(scrubText(value, 'full', options));
  return isRow(value) ? scrubLogentry(value, options) : undefined;
}

/** `formatted` and `message` only: a log entry's `params` can hold anything. */
function scrubLogentry(value: unknown, options: ScrubOptions): Row | undefined {
  if (!isRow(value)) return undefined;
  const out: Row = {};
  for (const key of ['formatted', 'message']) {
    const text = value[key];
    if (typeof text === 'string') out[key] = clip(scrubText(text, 'full', options));
  }
  return out;
}

function scrubPath(filename: string, keep: boolean, options: ScrubOptions): string {
  return scrubText(filename, keep ? 'keep-path' : 'full', options);
}

function scrubText(text: string, mode: 'full' | 'keep-path' | 'secrets', options: ScrubOptions): string {
  const known = applyKnownSecrets(text, options.secrets ?? []).text;
  const patterned = replaceMcpTokens(scrubSecrets(known)).text;
  const home = replaceHome(patterned, options.homeDir ?? '').text;
  const pathed = mode === 'full' ? replacePaths(home).text : home;
  return replaceNames(pathed, options.names ?? []).text;
}

function clip(text: string): string {
  return text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text;
}
