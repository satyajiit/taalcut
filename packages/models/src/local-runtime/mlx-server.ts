// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Taalcut's MLX server (MLX1; native/mlx-server, component `local-llm-runtime-mlx`): one process per launch on a free
 * loopback port, guarded by a per-launch key (TAALCUT_MLX_API_KEY), ready once /health says so, like llama-server.
 * It serves the same OpenAI-compatible Chat Completions, streamed, with tool calls and image input, from a model
 * folder (MLX safetensors, its tokenizer and config) on the GPU through Metal. MLX has no CPU path worth running a
 * 9B on, so there is no fallback inside the driver: a machine without MLX, or with the GPU turned off
 * (TAALCUT_FORCE_CPU), or a server that won't start, fails the launch, and the call's chain moves on to a model
 * llama.cpp serves.
 */
import { join } from 'node:path';
import type { FetchFn } from '../client/http-meter';
import { IMAGE_MIN_TOKENS } from './llama-server';
import { startSidecar, type SpawnPort } from './sidecar-process';
import type {
  InstalledComponentRef,
  LocalRuntimeDriver,
  LocalRuntimeModel,
  RunningLocalRuntime,
} from './types';

/** The executable in the runtime component, beside its mlx.metallib. */
export const MLX_SERVER_EXECUTABLE = 'taalcut-mlx-server';

export interface MlxServerDriverDeps {
  readonly spawn: SpawnPort;
  /** A TCP port that is free on 127.0.0.1 right now. */
  readonly freePort: () => Promise<number>;
  /** For the /health poll. Default: globalThis.fetch. */
  readonly fetch?: FetchFn;
  /** The executable inside the runtime component. Default `<path>/taalcut-mlx-server`. */
  readonly executable?: (runtime: InstalledComponentRef) => string;
  /** Default: a random UUID per launch. */
  readonly newApiKey?: () => string;
  /** Give up on /health after this long. Default 180 s (a cold 9B load took 4 s on an M5 Max, MLX1). */
  readonly startTimeoutMs?: number;
  readonly healthIntervalMs?: number;
  /** SIGTERM, then SIGKILL after this long. Default 5 s. */
  readonly stopGraceMs?: number;
}

export interface MlxServerArgsInput {
  readonly model: LocalRuntimeModel;
  /** The model component's folder. */
  readonly weights: string;
  readonly port: number;
}

/**
 * llama-server's flags where the two share one (`--model`, `--alias`, `--host`, `--port`, `--ctx-size`,
 * `--chat-template`, `--image-min-tokens`); the server refuses any host but loopback.
 */
export function mlxServerArgs(input: MlxServerArgsInput): string[] {
  return [
    '--model',
    input.weights,
    '--alias',
    input.model.id,
    '--host',
    '127.0.0.1',
    '--port',
    String(input.port),
    '--ctx-size',
    String(input.model.contextWindow),
    ...(input.model.chatTemplate ? ['--chat-template', input.model.chatTemplate] : []),
    ...(input.model.vision ? ['--image-min-tokens', String(IMAGE_MIN_TOKENS)] : []),
  ];
}

export function createMlxServerDriver(deps: MlxServerDriverDeps): LocalRuntimeDriver {
  const fetchFn: FetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const executable = deps.executable ?? ((runtime) => join(runtime.path, MLX_SERVER_EXECUTABLE));
  const newApiKey = deps.newApiKey ?? (() => globalThis.crypto.randomUUID());

  return {
    async launch(input): Promise<RunningLocalRuntime> {
      const first = input.models[0];
      if (!first) throw new Error('No model to load.');
      if (input.forcedCpu || !input.backends.includes('mlx'))
        throw new Error(`${MLX_SERVER_EXECUTABLE} runs on an Apple GPU only, and none is offered here.`);
      const { model, files } = first;
      const port = await deps.freePort();
      const apiKey = newApiKey();
      const server = await startSidecar({
        spawn: deps.spawn,
        fetch: fetchFn,
        name: MLX_SERVER_EXECUTABLE,
        command: executable(input.runtime),
        args: mlxServerArgs({ model, weights: files.path, port }),
        // Nothing of this process's environment, only the key.
        env: { TAALCUT_MLX_API_KEY: apiKey },
        port,
        apiKey,
        signal: input.signal,
        startTimeoutMs: deps.startTimeoutMs ?? 180_000,
        healthIntervalMs: deps.healthIntervalMs ?? 250,
        stopGraceMs: deps.stopGraceMs ?? 5_000,
      });
      return {
        endpoint: { kind: 'openai-compatible', baseUrl: `${server.origin}/v1`, apiKey, models: [model.id] },
        exited: server.exited.then(({ code, signal }) => ({ code, ...(signal ? { reason: signal } : {}) })),
        stop: server.stop,
        loadedModels: async () => (server.exit() ? [] : [{ id: model.id, backend: 'mlx' }]),
      };
    },
  };
}
