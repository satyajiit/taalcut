// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lines main already prints, kept for the debug bundle. The ring is fed by
 * rememberLog and by a console interceptor installed at boot. Utility stderr
 * is separate: the parent calls attachUtilityStderr when it forks. Test builds
 * also follow both as they arrive (onProcessOutput, test-process-logs.ts).
 */
/** Enough of a piped stderr: Node's Readable, which is what utilityProcess gives us. */
interface StderrStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

const TAGS = ['[update]', '[gpu]', '[components]', '[utility]'] as const;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STDERR_LINES = 500;
const STDERR_LINE = 2000;

interface Stamped {
  readonly at: number;
  readonly text: string;
}

const lines: Stamped[] = [];
let bytes = 0;
const stderr = new Map<string, string[]>();
let captureInstalled = false;

/** `main` for main's console lines, else the utility process whose stderr it is. */
type OutputListener = (process: string, text: string) => void;
const outputListeners = new Set<OutputListener>();

/** Every console line main prints and every chunk of utility stderr, as it arrives (not only the tagged ones). */
export function onProcessOutput(listener: OutputListener): () => void {
  outputListeners.add(listener);
  return () => outputListeners.delete(listener);
}

function tellListeners(process: string, text: string): void {
  for (const listener of outputListeners) listener(process, text);
}

export function rememberLog(line: string, at: number = Date.now()): void {
  if (!TAGS.some((tag) => line.includes(tag))) return;
  const text = line.length > 4000 ? line.slice(0, 4000) : line;
  lines.push({ at, text });
  bytes += Buffer.byteLength(text) + 1;
  trim(at);
}

/** Tagged lines at or after `sinceMs` (epoch ms). Default: the last 24 h. */
export function debugLogText(now: number = Date.now(), sinceMs?: number): string {
  const cutoff = sinceMs ?? now - MAX_AGE_MS;
  return lines
    .filter((line) => line.at >= cutoff)
    .map((line) => line.text)
    .join('\n');
}

export function rememberStderr(name: string, chunk: string): void {
  const bucket = stderr.get(name) ?? [];
  for (const part of chunk.split(/\r?\n/)) {
    if (part.length === 0) continue;
    bucket.push(part.length > STDERR_LINE ? part.slice(0, STDERR_LINE) : part);
  }
  if (bucket.length > STDERR_LINES) bucket.splice(0, bucket.length - STDERR_LINES);
  stderr.set(name, bucket);
}

export function stderrTail(name: string, count: number): string[] {
  return (stderr.get(name) ?? []).slice(-count);
}

/** Each utility's retained stderr, prefixed with its process name. */
export function utilityStderrText(): string {
  const blocks: string[] = [];
  for (const [name, bucket] of stderr) {
    for (const line of bucket) blocks.push(`[${name}] ${line}`);
  }
  return blocks.join('\n');
}

export function attachUtilityStderr(name: string, stream: StderrStream | null | undefined): void {
  stream?.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    rememberStderr(name, text);
    tellListeners(name, text);
  });
}

export function clearDebugLogs(): void {
  lines.length = 0;
  bytes = 0;
  stderr.clear();
}

/** Idempotent. Installed from boot even when crash reporting is off. */
export function installLogCapture(): void {
  if (captureInstalled) return;
  captureInstalled = true;
  const sink = globalThis.console;
  for (const method of ['error', 'warn', 'info', 'log', 'debug'] as const) {
    const original = sink[method].bind(sink);
    sink[method] = (...args: unknown[]) => {
      const line = args.map(formatArg).join(' ');
      rememberLog(line);
      tellListeners('main', line);
      original(...args);
    };
  }
}

function trim(now: number): void {
  const cutoff = now - MAX_AGE_MS;
  while (lines.length > 0 && (lines[0]!.at < cutoff || bytes > MAX_BYTES)) {
    const removed = lines.shift();
    if (!removed) break;
    bytes -= Buffer.byteLength(removed.text) + 1;
  }
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return String(value);
}
