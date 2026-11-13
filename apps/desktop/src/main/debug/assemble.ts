// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's debug bundle: environment, logs and recovery, plus whatever the
 * injected collectors (jobs, agent) return. Collector text is not redacted
 * here. The 20MB cap drops the oldest log lines first.
 */
import { gzipSync } from 'node:zlib';
import type { DebugCollectOptions, DebugSection } from '@taalcut/core';
import { debugLogText, utilityStderrText } from './log-ring';
import { redactText, type RedactionCounts } from './redact-text';

const CAP_BYTES = 20 * 1024 * 1024;
const LOG_PATH = 'main/logs.txt';

export interface MainDebugEnvironment {
  readonly version: string;
  readonly channel: string;
  readonly os: string;
  readonly chip: string;
  readonly memory: unknown;
  readonly tier: string;
  readonly shortfalls: readonly string[];
  readonly gpu: unknown;
  readonly components: unknown;
  readonly flavour: string;
}

export interface AssembleDeps {
  readonly environment: () => MainDebugEnvironment | Promise<MainDebugEnvironment>;
  readonly recovery: () => unknown;
  readonly collectors: readonly ((
    options: DebugCollectOptions,
  ) => readonly DebugSection[] | Promise<readonly DebugSection[]>)[];
  readonly secrets: readonly string[];
  readonly homeDir: string;
  readonly now?: () => number;
}

export interface PackedDebugBundle {
  readonly fileName: string;
  readonly json: string;
  readonly gzip: Buffer;
  readonly sections: readonly DebugSection[];
  readonly totalBytes: number;
}

export function debugBundleFileName(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  return `Taalcut-debug-${day}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}.json.gz`;
}

export async function buildDebugBundle(
  deps: AssembleDeps,
  options: DebugCollectOptions,
): Promise<PackedDebugBundle> {
  const now = deps.now?.() ?? Date.now();
  const environment = await deps.environment();
  const sections = await collectSections(deps, options, now, environment);
  const packed = fit(sections, {
    createdAt: new Date(now).toISOString(),
    app: appOf(environment),
    options,
  });
  return {
    fileName: debugBundleFileName(new Date(now)),
    json: packed.json,
    gzip: gzipSync(packed.json),
    sections: packed.sections,
    totalBytes: packed.sections.reduce((sum, section) => sum + Buffer.byteLength(section.text), 0),
  };
}

async function collectSections(
  deps: AssembleDeps,
  options: DebugCollectOptions,
  now: number,
  environment: MainDebugEnvironment,
): Promise<DebugSection[]> {
  const redact = (text: string) => redactText(text, { secrets: deps.secrets, homeDir: deps.homeDir });
  const main: DebugSection[] = [
    section('environment', 'main/environment.json', 'application/json', redact(JSON.stringify(environment))),
    section('logs', LOG_PATH, 'text/plain', redact(logText(now, options.sinceMs))),
    section(
      'recovery',
      'main/recovery.json',
      'application/json',
      redact(JSON.stringify(stripDetail(deps.recovery()))),
    ),
  ];
  const extra: DebugSection[] = [];
  for (const collect of deps.collectors) extra.push(...(await collect(options)));
  return [...main, ...extra];
}

function logText(now: number, sinceMs: number | undefined): string {
  const tagged = debugLogText(now, sinceMs);
  const stderr = utilityStderrText();
  if (tagged.length === 0) return stderr;
  if (stderr.length === 0) return tagged;
  return `${tagged}\n${stderr}`;
}

function appOf(environment: MainDebugEnvironment): {
  name: string;
  version: string;
  channel: string;
  flavour: string;
} {
  return {
    name: 'Taalcut',
    version: environment.version,
    channel: environment.channel,
    flavour: environment.flavour,
  };
}

interface ManifestMeta {
  readonly createdAt: string;
  readonly app: { name: string; version: string; channel: string; flavour: string };
  readonly options: DebugCollectOptions;
}

function fit(sections: DebugSection[], meta: ManifestMeta): { sections: DebugSection[]; json: string } {
  const full = encode(sections, meta);
  if (Buffer.byteLength(full.json) <= CAP_BYTES) return full;
  const logs = sections.find((item) => item.path === LOG_PATH);
  if (!logs) return full;
  const lines = logs.text.split('\n');
  let low = 1;
  let high = lines.length;
  let best = sized(sections, lines, lines.length, meta);
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = sized(sections, lines, mid, meta);
    if (Buffer.byteLength(candidate.json) <= CAP_BYTES) {
      best = candidate;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return best;
}

function sized(sections: DebugSection[], lines: string[], drop: number, meta: ManifestMeta) {
  const note = `[debug] dropped ${drop} oldest log lines to stay within 20MB`;
  const kept = lines.slice(drop).join('\n');
  const text = kept.length > 0 ? `${note}\n${kept}` : note;
  return encode(
    sections.map((item) => (item.path === LOG_PATH ? { ...item, text } : item)),
    meta,
  );
}

function encode(
  sections: readonly DebugSection[],
  meta: ManifestMeta,
): { sections: DebugSection[]; json: string } {
  const body = {
    manifest: {
      version: 1 as const,
      createdAt: meta.createdAt,
      app: meta.app,
      options: meta.options,
      sections: sections.map((item) => ({
        path: item.path,
        bytes: Buffer.byteLength(item.text),
        redactions: item.redactions,
      })),
    },
    sections: sections.map((item) => ({ path: item.path, mediaType: item.mediaType, text: item.text })),
  };
  return { sections: [...sections], json: JSON.stringify(body) };
}

function section(
  name: DebugSection['section'],
  path: string,
  mediaType: DebugSection['mediaType'],
  redacted: { text: string; redactions: RedactionCounts },
): DebugSection {
  return {
    section: name,
    process: 'main',
    path,
    mediaType,
    text: redacted.text,
    redactions: { ...redacted.redactions },
  };
}

function stripDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDetail);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'detail') continue;
    out[key] = stripDetail(item);
  }
  return out;
}
