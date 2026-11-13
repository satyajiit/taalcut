// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's live model, the 9B on MLX as the app serves it at High: Taalcut's MLX server (with its
 * tool-call grammar) started by the app's own local runtime manager and MLX driver, the model's own chat template
 * and window, thinking off (the agentLarge profile). Give the server's folder and the weights' folder:
 *
 *   TAALCUT_MLX_SERVER=<folder with taalcut-mlx-server> TAALCUT_MLX_9B=<weights folder> pnpm edit:requests --live
 *
 * FIX-CMT: TAALCUT_EVAL_TEMPERATURE=<t> sends that temperature on each call with tools (the app sends none, so the
 * server samples at its default, 0.8), to measure sampling on the 9B's tool calls.
 */
import { ok } from '@taalcut/core';
import {
  attachLocalRuntime,
  createLocalRuntimeManager,
  createMemoryCloudCallSink,
  createMlxServerDriver,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  LOCAL_RUNTIME_PROVIDER,
  localRuntimeSpec,
  type ComponentInstaller,
  type CredentialProvider,
  type InstalledComponentRef,
  type ModelChoice,
  type ModelClient,
  type ModelClientDeps,
  type ModelRequest,
  type ModelRuntime,
} from '@taalcut/models';
import { createNodeSpawnPort, findFreeLoopbackPort } from '@taalcut/models/node';

export const LIVE_MODEL = 'qwen3.5-9b';

export interface LiveModel {
  readonly client: ModelClient;
  readonly name: string;
  /** AGT2: the model's context window, which the app sizes a step's tool offer and compaction by. */
  readonly window: number;
  stop(): Promise<void>;
}

/** The temperature TAALCUT_EVAL_TEMPERATURE asks for, when it is a number from 0 to 2. */
function evalTemperature(): number | undefined {
  const raw = process.env.TAALCUT_EVAL_TEMPERATURE;
  const value = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : undefined;
}

/** `client`, sending `temperature` on each call with tools that sets none. */
function withToolTemperature(client: ModelClient, temperature: number | undefined): ModelClient {
  if (temperature === undefined) return client;
  const set = (request: ModelRequest): ModelRequest =>
    request.tools?.length && request.temperature === undefined ? { ...request, temperature } : request;
  return { stream: (request) => client.stream(set(request)), complete: (request) => client.complete(set(request)) };
}

/**
 * The client an eval runs a live model on: the app's own createModelClient over `runtime` and `credentials`, with the
 * eval's own call log, every module on one choice. The 9B on MLX (below) and the ChatGPT plan (plan/chatgpt.ts) both
 * use it, so their requests are shaped as the app's.
 */
export function evalModelClient(
  deps: Pick<ModelClientDeps, 'retry' | 'fetch' | 'localAdapter' | 'localLease' | 'localDeadlineMs'> & {
    readonly runtime: ModelRuntime;
    readonly credentials: CredentialProvider;
    readonly choice: ModelChoice;
  },
): ModelClient {
  const { choice, ...rest } = deps;
  return createModelClient({
    ...rest,
    callLog: createMemoryCloudCallSink(),
    selector: { resolve: (module) => ok({ module, choices: [choice] }) },
  });
}

export async function startLiveModel(paths: { readonly server: string; readonly weights: string }): Promise<LiveModel> {
  const high = localRuntimeSpec('high', 'darwin-arm64');
  const model = high.models.find((entry) => entry.id === LIVE_MODEL);
  if (!model?.runtimeComponentId) throw new Error(`The High spec has no ${LIVE_MODEL} on MLX`);
  const refs: Record<string, InstalledComponentRef> = {
    [model.runtimeComponentId]: { id: model.runtimeComponentId, version: 'eval', path: paths.server },
    [model.componentId]: { id: model.componentId, version: 'eval', path: paths.weights },
  };
  const installer: ComponentInstaller = {
    install: async (id) => ok(refs[id]!),
    get: async (id) => refs[id],
  };
  const spawn = createNodeSpawnPort();
  const output: string[] = [];
  const manager = createLocalRuntimeManager({
    spec: { ...high, runtimeComponentId: model.runtimeComponentId, models: [model] },
    installer,
    driver: createMlxServerDriver({
      spawn: { spawn: (request) => spawn.spawn({ ...request, onOutput: (line) => output.push(line) }) },
      freePort: findFreeLoopbackPort,
      startTimeoutMs: 180_000,
    }),
    backends: ['metal', 'mlx', 'cpu'],
    tier: 'high',
    idleUnloadMs: 0,
  });
  const runtime = createModelRuntime({ builtinProviders: [] });
  const attached = attachLocalRuntime(manager, [runtime]);
  const started = await manager.start();
  if (!started.ok) throw new Error(`The MLX server didn't start: ${started.error.code} (${started.error.detail ?? 'no detail'})\n${output.slice(-20).join('\n')}`);
  const client = evalModelClient({
    runtime,
    credentials: createStaticCredentialProvider({}),
    localAdapter: attached.localAdapter,
    localLease: attached.localLease,
    retry: { maxRetries: 0, timeoutMs: 300_000 },
    // FIX-CMT: a turn still going after 5 minutes fails as timed out (the app's default is 15).
    localDeadlineMs: 300_000,
    choice: { provider: LOCAL_RUNTIME_PROVIDER, model: LIVE_MODEL, reasoning: 'off' },
  });
  const temperature = evalTemperature();
  return {
    client: withToolTemperature(client, temperature),
    window: model.contextWindow,
    name: `${LOCAL_RUNTIME_PROVIDER}/${LIVE_MODEL} (MLX, ${model.contextWindow} tokens${temperature === undefined ? '' : `, temperature ${temperature} with tools`})`,
    async stop() {
      attached.detach();
      await manager.stop();
      spawn.dispose();
    },
  };
}
