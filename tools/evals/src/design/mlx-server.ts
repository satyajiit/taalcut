// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The 9B on this Mac for the design eval's live run (from the retired graphics:create eval): Taalcut's MLX server
 * (native/mlx-server) on a loopback port with a per-run key, as packages/models launches it (MLX1): the High tier's
 * window (32,768) and the model folder's chat template with its tools written compact (packages/models
 * `compactToolsTemplate`, the same one replacement); ready once /health says so; stopped by its pid.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** How the model folder's template writes one tool, and how the app's does (packages/models chat-template.ts). */
const SPACED_TOOL = '{{- tool | tojson }}';
const COMPACT_TOOL = '{{- tool | tojson(separators=(",", ":")) }}';

/** The app's window for the 9B on the High tier (packages/models `contextWindowFor('high')`). */
export const APP_WINDOW = 32_768;

export interface RunningServer {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  stop(): Promise<void>;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });

export async function startMlxServer(options: {
  readonly binary: string;
  readonly weights: string;
  readonly model?: string;
  readonly contextSize?: number;
  readonly startTimeoutMs?: number;
}): Promise<RunningServer> {
  const port = await freePort();
  const apiKey = randomUUID();
  const model = options.model ?? 'qwen3.5-9b';
  const own = await readFile(join(options.weights, 'chat_template.jinja'), 'utf8');
  if (!own.includes(SPACED_TOOL))
    throw new Error("the model folder's chat template writes its tools another way");
  const chatTemplate = own.replace(SPACED_TOOL, COMPACT_TOOL);
  const child: ChildProcess = spawn(
    options.binary,
    [
      '--model',
      options.weights,
      '--alias',
      model,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--ctx-size',
      String(options.contextSize ?? APP_WINDOW),
      '--chat-template',
      chatTemplate,
    ],
    { env: { ...process.env, TAALCUT_MLX_API_KEY: apiKey }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let log = '';
  let failed: Error | null = null;
  child.once('error', (error) => {
    failed = error;
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-4000);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (options.startTimeoutMs ?? 180_000);
  const stop = async () => {
    if (child.exitCode !== null || child.pid === undefined) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  while (Date.now() < deadline) {
    if (failed) throw new Error(`the MLX server did not start: ${String(failed)}`);
    if (child.exitCode !== null) throw new Error(`the MLX server exited (${child.exitCode}): ${log}`);
    const health = await fetch(`${baseUrl}/health`).catch(() => null);
    if (health?.ok) return { baseUrl, apiKey, model, stop };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`the MLX server did not become ready: ${log}`);
}
