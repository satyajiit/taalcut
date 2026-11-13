// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A long-lived stdio JSON-lines client for native/mac-helper. One process,
 * many requests, matched by id. Cancelling a request writes a cancel line;
 * it does not kill the process. A crash fails the requests in flight, and
 * the next request starts a fresh process and waits for its ready line.
 * Protocol v2 `event` lines (no request id) go to `onEvent` listeners.
 * Ending the process follows the end policy (json-line-end.ts).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { err, ok, type AsyncResult, type Err, type Result, type TaalcutError } from '@taalcut/core';
import { MediaCancelled, MediaTimeout, SpawnFailed } from '../errors';
import { SidecarFailed, SidecarNotFound } from './errors';
import { sidecarEnv, USE_PROCESS_GROUPS } from '../process/child-group';
import { DEFAULT_END_POLICY, type EndPolicy } from '../process/end-policy';
import { endHelper } from './json-line-end';
import type { JsonLineMessage, JsonLineRequestOptions, JsonValue } from './json-line-types';
import { createLetGoTracker } from './let-go';
import { startRequestClock } from './request-clock';
import { responseOf, settleCancelled, type Pending } from './request-settling';

export type { JsonLineMessage, JsonLineRequestOptions, JsonValue } from './json-line-types';

/** An unsolicited protocol v2 `event` line: `{ type: 'event', service, name, data }`. */
export interface JsonLineEvent {
  readonly service: string | undefined;
  readonly name: string;
  readonly data: JsonValue;
}

export interface JsonLineSidecar {
  ready(): AsyncResult<JsonValue>;
  request(method: string, params: JsonValue, options?: JsonLineRequestOptions): AsyncResult<JsonValue>;
  close(): Promise<void>;
}

/** What createJsonLineSidecar returns: the client plus the helper's protocol v2 `event` lines. */
export interface JsonLineEventSidecar extends JsonLineSidecar {
  /** Every event line from this sidecar, across restarts. Returns the unsubscribe. */
  onEvent(listener: (event: JsonLineEvent) => void): () => void;
}

export interface JsonLineSidecarOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly maxLineBytes?: number;
  readonly idleExitMs?: number;
  /** A started process that prints no ready line in this time is killed and the start fails. */
  readonly readyTimeoutMs?: number;
  /**
   * The helper may hold hardware video sessions (the mac helper's `decode`, `grade` and `track` services:
   * `HelperService.holdsVideoSession` in its Protocol.swift). Ending it is then the end of its stdin and a wait,
   * never a signal: killing a process stuck in VideoToolbox preceded both watchdog resets on the development Mac
   * (2026-10-17). One that hasn't exited after the stall grace is reported once and left running. Default false
   * (OCR, speech, embed, shots, devices, Content Credentials): SIGTERM, then SIGKILL after a second.
   */
  readonly holdsVideoSession?: boolean;
  /** How processes are ended (process/end-policy.ts). Default `DEFAULT_END_POLICY`. */
  readonly endPolicy?: EndPolicy;
}

const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;
/** Between `close()`'s SIGTERM and SIGKILL for a helper that holds no video session. */
const CLOSE_GRACE_MS = 1000;

export function createJsonLineSidecar(options: JsonLineSidecarOptions): JsonLineEventSidecar {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const pending = new Map<string, Pending>();
  const holding = createLetGoTracker();
  const listeners = new Set<(event: JsonLineEvent) => void>();
  let child: ChildProcess | undefined;
  let buffer = Buffer.alloc(0);
  let stderr = '';
  let closed = false;
  let readyResult: Result<JsonValue> | undefined;
  let readyWait: Promise<Result<JsonValue>> | undefined;
  const ending = {
    policy: options.endPolicy ?? DEFAULT_END_POLICY,
    holding: { holdsVideoSession: options.holdsVideoSession === true },
    command: options.command,
    args: launchArgs(options),
  };
  /** Ends a process this client gave up on, at once: SIGKILL, or for a video-session helper its stdin's end. */
  const abandon = (proc: ChildProcess): void => {
    void endHelper(proc, { ...ending, graceMs: 0, reason: 'abandoned' });
  };

  const failAll = (error: TaalcutError): void => {
    readyResult = err(error);
    readyWait = undefined;
    child = undefined;
    for (const [id, item] of pending) {
      pending.delete(id);
      item.clock?.clear();
      if (item.timer) clearTimeout(item.timer);
      item.settle(err(error));
    }
  };

  const handleLine = (text: string): void => {
    if (text.trim() === '') return;
    let value: JsonValue;
    try {
      value = JSON.parse(text) as JsonValue;
    } catch (cause) {
      if (!readyResult?.ok) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        readyResult = err(SidecarFailed(undefined, { detail }));
        readyWait = undefined;
      }
      return;
    }
    const message = value as JsonLineMessage;
    if (message.type === 'ready') {
      readyResult = ok(value);
      return;
    }
    if (message.type === 'event') {
      if (typeof message.name !== 'string' || message.name.length === 0) return;
      const event: JsonLineEvent = {
        service: typeof message.service === 'string' ? message.service : undefined,
        name: message.name,
        data: message.data ?? {},
      };
      for (const listener of listeners) listener(event);
      return;
    }
    const id = message.id ?? '';
    holding.read(message);
    const item = pending.get(id);
    if (!item) return;
    if (message.type === 'progress') {
      item.clock?.touch();
      item.onNotification?.(message);
      return;
    }
    if (message.type !== 'response') return;
    pending.delete(id);
    item.clock?.clear();
    if (item.timer) clearTimeout(item.timer);
    item.settle(responseOf(message));
  };

  const onStdout = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxLineBytes && !buffer.includes(0x0a)) {
      const current = child;
      failAll(SidecarFailed(undefined, { detail: 'sidecar line is longer than the limit' }));
      if (current) abandon(current);
      return;
    }
    let newline = buffer.indexOf(0x0a);
    while (newline >= 0) {
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > maxLineBytes) {
        const current = child;
        failAll(SidecarFailed(undefined, { detail: 'sidecar line is longer than the limit' }));
        if (current) abandon(current);
        return;
      }
      handleLine(line.toString('utf8'));
      newline = buffer.indexOf(0x0a);
    }
  };

  const ensure = (): Promise<Result<JsonValue>> => {
    if (closed) return Promise.resolve(err(SidecarFailed(undefined, { detail: 'sidecar is closed' })));
    if (readyResult?.ok && child?.exitCode === null && child.signalCode === null)
      return Promise.resolve(readyResult);
    if (readyWait) return readyWait;
    readyResult = undefined;
    let spawned: ChildProcess;
    try {
      spawned = spawn(options.command, launchArgs(options), {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: USE_PROCESS_GROUPS,
        env: sidecarEnv(options.env),
      });
    } catch (cause) {
      return Promise.resolve(spawnFailure(options.command, cause));
    }
    child = spawned;
    buffer = Buffer.alloc(0);
    const wait = new Promise<Result<JsonValue>>((resolve) => {
      const finish = (result: Result<JsonValue>): void => {
        if (readyWait === wait) readyWait = undefined;
        resolve(result);
      };
      spawned.on('error', (cause) => {
        holding.failed(spawned);
        const failure = spawnFailure(options.command, cause);
        if (child === spawned) failAll(failure.error);
        finish(failure);
      });
      spawned.stdout?.on('data', (chunk: Buffer) => {
        if (child === spawned) onStdout(chunk);
      });
      spawned.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-4096);
      });
      // A write after the process died is EPIPE on stdin: fail what is pending instead of throwing.
      spawned.stdin?.on('error', (cause: Error) => {
        if (child !== spawned) return;
        failAll(SidecarFailed(undefined, { detail: `sidecar stdin: ${cause.message}` }));
        abandon(spawned);
      });
      spawned.on('close', () => {
        holding.exited(spawned);
        const failure = err(SidecarFailed(undefined, { detail: stderr || 'sidecar exited' }));
        if (child === spawned) failAll(failure.error);
        finish(failure);
      });
      const poll = setInterval(() => {
        if (readyResult) {
          clearInterval(poll);
          if (startTimer) clearTimeout(startTimer);
          finish(readyResult);
        }
      }, 10);
      const startTimer =
        options.readyTimeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              if (readyResult || child !== spawned) return;
              clearInterval(poll);
              const failure = err(SidecarFailed(undefined, { detail: 'sidecar printed no ready line' }));
              failAll(failure.error);
              abandon(spawned);
              finish(failure);
            }, options.readyTimeoutMs);
      spawned.on('close', () => {
        clearInterval(poll);
        if (startTimer) clearTimeout(startTimer);
      });
    });
    readyWait = wait;
    return wait;
  };

  const write = (value: JsonValue): void => {
    child?.stdin?.write(`${JSON.stringify(value)}\n`);
  };

  return {
    ready: () => ensure(),
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async request(method, params, requestOptions = {}) {
      const target = await sendTo(requestOptions.signal, ensure, () => child);
      if (!target.ok) return holding.unsent(target, requestOptions.onLetGo);
      const id = randomUUID();
      holding.hold(id, target.value, requestOptions.onLetGo);
      const result = new Promise<Result<JsonValue>>((resolve) => {
        const clock = startRequestClock(requestOptions, ({ kind, ms }) =>
          giveUp(
            err(
              MediaTimeout(
                { ms },
                kind === 'stall' ? { detail: `the helper said nothing about ${method} for ${ms} ms` } : {},
              ),
            ),
          ),
        );
        pending.set(id, {
          settle: resolve,
          clock,
          ...(requestOptions.onNotification ? { onNotification: requestOptions.onNotification } : {}),
        });
      });
      function giveUp(outcome: Result<JsonValue>): void {
        write({ type: 'cancel', id });
        settleCancelled(pending, id, method, requestOptions, outcome);
      }
      const onAbort = (): void => giveUp(err(MediaCancelled()));
      requestOptions.signal?.addEventListener('abort', onAbort, { once: true });
      if (target.value.pid !== undefined) requestOptions.onSend?.(target.value.pid);
      write({ type: 'request', id, method, params });
      try {
        return await result;
      } finally {
        requestOptions.signal?.removeEventListener('abort', onAbort);
      }
    },
    async close() {
      closed = true;
      const current = child;
      child = undefined;
      if (!current || current.exitCode !== null) return;
      await endHelper(current, { ...ending, graceMs: CLOSE_GRACE_MS, reason: 'closed' });
    },
  };
}

/** The process a request goes to, started if need be; a request cancelled meanwhile goes nowhere. */
async function sendTo(
  signal: AbortSignal | undefined,
  ensure: () => AsyncResult<JsonValue>,
  current: () => ChildProcess | undefined,
): AsyncResult<ChildProcess> {
  if (signal?.aborted) return err(MediaCancelled());
  const started = await ensure();
  if (!started.ok) return started;
  if (signal?.aborted) return err(MediaCancelled());
  const target = current();
  return target ? ok(target) : err(SidecarFailed(undefined, { detail: 'sidecar exited' }));
}

function launchArgs(options: JsonLineSidecarOptions): string[] {
  const args = [...(options.args ?? [])];
  const idle = options.idleExitMs;
  if (idle === undefined || idle <= 0 || args.includes('--idle-exit')) return args;
  const seconds = Math.round(idle / 1000);
  if (seconds < 1) return args;
  return [...args, '--idle-exit', String(seconds)];
}

function spawnFailure(command: string, cause: unknown): Err<TaalcutError> {
  const code = typeof cause === 'object' && cause && 'code' in cause ? String(cause.code) : '';
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (code === 'ENOENT') return err(SidecarNotFound({ binary: command }, { detail }));
  return err(SpawnFailed(undefined, { detail }));
}
