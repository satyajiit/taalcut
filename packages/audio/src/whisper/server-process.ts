// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One `whisper-server` process: launched on a free loopback port under a random path, ready once `/health` says
 * so, then asked over HTTP. Progress lines from `-pp` go to the request in flight (the server answers one at a
 * time). Aborting a request closes its connection, which whisper.cpp checks between decoder steps, so the process
 * stays up for the next one. A process that exits is reported as such, so the pool can start another.
 */
import { randomBytes } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { err, jsonFromText, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { EngineUnavailable } from '../errors';
import type { WhisperServerConfig } from './server-args';
import { describeExit, sleep, startServerChild, type ServerChild } from './server-child';
import { serverErrorSchema, verboseJsonSchema, type VerboseJson } from './server-response';
import type { ServerExit, ServerSpawn } from './server-spawn';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerLaunchDeps {
  readonly spawn: ServerSpawn;
  readonly fetch: FetchFn;
  readonly freePort: () => Promise<number>;
  /** The process's working folder; `<dir>/no-public` is never created. */
  readonly workDir: string;
  /** Default 60 s: a cold medium load with Metal shader compilation took 2–3 s on an M-series Mac. */
  readonly startTimeoutMs?: number;
  readonly healthIntervalMs?: number;
}

export interface WhisperServerProcess {
  readonly config: WhisperServerConfig;
  readonly pid: number | undefined;
  readonly port: number;
  readonly secret: string;
  /** Where whisper.cpp said it runs: `cpu` when it found no GPU (or was told `-ng`). */
  readonly backend: 'gpu' | 'cpu';
  alive(): boolean;
  /** Settles when the process has exited, for any reason. */
  readonly exited: Promise<void>;
  /** POST /inference with the WAV and these form fields. */
  infer(
    audio: string,
    fields: Readonly<Record<string, string>>,
    options: { readonly signal?: AbortSignal; readonly onProgress?: (fraction: number) => void },
  ): AsyncResult<VerboseJson, InferFailure>;
  stop(): Promise<void>;
}

/** Why an inference didn't answer: cancelled, the process died under it, or the server said no. */
export type InferFailure =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'crashed'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };

export interface LaunchFailure {
  /** The process exited while loading and said something about Metal or the GPU: worth a try on the CPU. */
  readonly gpuFailed: boolean;
  readonly error: TaalcutError;
}

/** Polls `/health` (503 while the model loads, 200 once it serves) until it is ready, exits or runs out of time. */
async function waitUntilReady(
  deps: ServerLaunchDeps,
  origin: string,
  exited: () => ServerExit | undefined,
  exitedOnce: Promise<unknown>,
): Promise<'ready' | 'exited' | 'timeout'> {
  const deadline = Date.now() + (deps.startTimeoutMs ?? 60_000);
  for (;;) {
    if (exited()) return 'exited';
    if (Date.now() > deadline) return 'timeout';
    try {
      const health = await deps.fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
      await health.body?.cancel();
      if (health.ok) return 'ready';
    } catch {
      // Not listening yet.
    }
    await Promise.race([exitedOnce, sleep(deps.healthIntervalMs ?? 100)]);
  }
}

/** POST /inference with the WAV (streamed from disk: an hour of PCM is never read into memory) and the fields. */
async function postInference(
  fetch: FetchFn,
  origin: string,
  audio: string,
  fields: Readonly<Record<string, string>>,
  signal: AbortSignal | undefined,
): AsyncResult<VerboseJson, InferFailure> {
  const form = new FormData();
  form.append('file', await openAsBlob(audio), 'audio.wav');
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const response = await fetch(`${origin}/inference`, {
    method: 'POST',
    body: form,
    ...(signal ? { signal } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    const said = serverErrorSchema.safeParse(jsonFromText(text));
    return err({
      kind: 'failed',
      detail: `HTTP ${response.status}: ${said.success ? said.data.error : text.slice(0, 300)}`,
    });
  }
  const parsed = verboseJsonSchema.safeParse(jsonFromText(text));
  return parsed.success
    ? ok(parsed.data)
    : err({ kind: 'failed', detail: `unexpected answer: ${text.slice(0, 300)}` });
}

/**
 * A load that died on the GPU: Metal's errors, ggml's CUDA and Vulkan backends, or the loader missing a GPU build's
 * library (`error while loading shared libraries: libcudart.so.13`: cuda-runtime-13 not on LD_LIBRARY_PATH).
 */
export const GPU_FAILURE = /metal|gpu|MTL|cuda|vulkan|error while loading shared libraries/i;

/** Why the process never got ready: exited while loading (a GPU error is worth a try on the CPU) or too slow. */
function launchFailure(
  ready: 'exited' | 'timeout',
  server: ServerChild,
  config: WhisperServerConfig,
): LaunchFailure {
  const exit = server.exit();
  if (exit?.startError) {
    // The OS refused to run the file (not executable, or gone): nothing loaded, and no GPU to blame.
    const detail = `could not start ${config.binary}: ${exit.startError}`;
    return { gpuFailed: false, error: EngineUnavailable({ engine: 'whisper' }, { detail }) };
  }
  const output = server.output();
  const why = exit ? `exited (${describeExit(exit)}) while loading` : 'was not ready in time';
  return {
    gpuFailed: ready === 'exited' && config.gpu && GPU_FAILURE.test(output),
    error: EngineUnavailable(
      { engine: 'whisper' },
      { detail: `whisper-server ${why}\n${output}`.slice(-1500) },
    ),
  };
}

/** One inference; a dropped connection with the process gone is a crash (the pool starts a new one). */
async function inferOn(
  server: ServerChild,
  fetch: FetchFn,
  origin: string,
  request: {
    readonly audio: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal | undefined;
    readonly onProgress?: ((fraction: number) => void) | undefined;
  },
): AsyncResult<VerboseJson, InferFailure> {
  if (request.signal?.aborted) return err({ kind: 'cancelled' });
  server.onProgress(request.onProgress);
  try {
    return await postInference(fetch, origin, request.audio, request.fields, request.signal);
  } catch (cause) {
    if (request.signal?.aborted) return err({ kind: 'cancelled' });
    await Promise.race([server.exited, sleep(200)]);
    const detail = `${cause instanceof Error ? cause.message : 'request failed'}\n${server.output()}`.slice(
      -1500,
    );
    return err(server.exit() ? { kind: 'crashed', detail } : { kind: 'failed', detail });
  } finally {
    server.onProgress(undefined);
  }
}

export async function launchWhisperServer(
  config: WhisperServerConfig,
  deps: ServerLaunchDeps,
): AsyncResult<WhisperServerProcess, LaunchFailure> {
  const port = await deps.freePort();
  const secret = randomBytes(16).toString('hex');
  const server = startServerChild(config, { spawn: deps.spawn, workDir: deps.workDir, port, secret });
  const origin = `http://127.0.0.1:${port}/${secret}`;
  const ready = await waitUntilReady(deps, origin, server.exit, server.exited);
  if (ready !== 'ready') {
    if (ready === 'timeout') await server.stop();
    return err(launchFailure(ready, server, config));
  }
  return ok({
    config,
    pid: server.pid,
    port,
    secret,
    get backend() {
      return server.backend();
    },
    alive: () => server.exit() === undefined,
    exited: server.exited.then(() => undefined),
    stop: () => server.stop(),
    infer: (audio, fields, options) => inferOn(server, deps.fetch, origin, { audio, fields, ...options }),
  });
}
