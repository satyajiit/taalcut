// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Parsers for Linux's text files: /proc/cpuinfo, /proc/meminfo, os-release and sysfs CPU lists. Pure. */

/** The first CPU's model name and how many logical CPUs are listed. ARM kernels print no model name. */
export function parseCpuinfo(text: string): { readonly model?: string; readonly logical: number } {
  let model: string | undefined;
  let logical = 0;
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (key === 'processor') logical++;
    else if (key === 'model name' && model === undefined) model = line.slice(at + 1).trim() || undefined;
  }
  return { ...(model ? { model } : {}), logical };
}

/** MemTotal in bytes (the file says kB, meaning KiB). */
export function parseMemTotal(text: string): number | undefined {
  const match = /^MemTotal:\s+(\d+)\s*kB/m.exec(text);
  return match ? Number(match[1]) * 1024 : undefined;
}

/** os-release's KEY=value lines, quotes removed (freedesktop.org's format: shell-style quoting, one per line). */
export function parseOsRelease(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key = '', raw = ''] = match;
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    values.set(key, quoted ? (quoted[2] ?? '').replace(/\\(["'$`\\])/g, '$1') : raw);
  }
  return values;
}

/** A sysfs CPU list ('0-15', '0-7,16-23', '3') → how many CPUs it names; 0 when it isn't one. */
export function countCpuList(text: string): number {
  let count = 0;
  for (const part of text.trim().split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) return 0;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (to < from) return 0;
    count += to - from + 1;
  }
  return count;
}

/** '24.04' or '22.04.5' → [24, 4]; undefined when it isn't a version. */
export function versionParts(version: string): readonly [number, number] | undefined {
  const match = /^(\d+)(?:\.(\d+))?/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : undefined;
}
