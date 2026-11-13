// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio indexing's wiring in the jobs process (IX-A5): with Parakeet's model installed, the transcript stage
 * enqueues the Parakeet kind and the runtime starts the mac helper's ASR service over that model, allowed to
 * read the audio store's folder only (a fake helper here); without the helper, Parakeet is undefined (logged
 * once) and the job transcribes with whisper.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createContainer, createMemorySettingsStore, newId, type AssetIndexView } from '@taalcut/core';
import { createAudioIndexingRuntime, registerAudioIndexing } from '../src/utility/roots/audio-indexing';
import { indexStageWiring } from '../src/utility/roots/index-stages';
import { testConfig } from './helpers/roots';

const FAKE_HELPER = fileURLToPath(new URL('./fixtures/fake-asr-helper.mjs', import.meta.url));
const PARAKEET = 'parakeet-tdt-0-6b-v3-coreml';
const savedHelper = process.env.TAALCUT_MAC_HELPER;

afterEach(() => {
  if (savedHelper === undefined) Reflect.deleteProperty(process.env, 'TAALCUT_MAC_HELPER');
  else process.env.TAALCUT_MAC_HELPER = savedHelper;
});

const settings = createMemorySettingsStore();

function spanishView(): AssetIndexView {
  const slice = { language: 'es', probability: 0.9 };
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/footage/charla.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1000,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [],
    transcript: null,
    outputs: {
      'audio.language': {
        silent: false,
        measure: {
          integratedLufs: -20,
          loudnessRange: 3,
          truePeakDbtp: -2,
          nonSilentRatio: 0.9,
          nonSilentMs: 9000,
          durationMs: 10_000,
        },
        detected: { ...slice, perSlice: [slice] },
      },
    },
  };
}

function runtime() {
  const logs: string[] = [];
  const config = testConfig('jobs');
  const audio = createAudioIndexingRuntime(config, {
    backends: async () => ['metal', 'coreml', 'ane', 'cpu'],
    onFallback: () => undefined,
    log: (message) => logs.push(message),
  });
  return { audio, logs, config };
}

describe('audio indexing wiring', () => {
  it("enqueues Spanish on Parakeet's kind once its model is installed, on whisper's before", async () => {
    let installed = false;
    const wiring = indexStageWiring({
      tier: async () => 'recommended',
      settings: () => settings,
      installed: (id) => installed && id === PARAKEET,
    });
    const transcript = wiring.stages.find((stage) => stage.stage === 'audio.transcript');
    await wiring.refresh();
    expect(transcript?.job(spanishView())).toMatchObject({ kind: { kind: 'audio.transcribeAssetWhisper' } });
    installed = true;
    await wiring.refresh();
    expect(transcript?.job(spanishView())).toMatchObject({ kind: { kind: 'audio.transcribeAssetParakeet' } });
  });

  it("starts the helper's ASR service over the model folder, allowed only the store's folder", async () => {
    const { audio, config } = runtime();
    process.env.TAALCUT_MAC_HELPER = FAKE_HELPER;
    const models = join(config.userData, 'components', PARAKEET);
    try {
      const sidecar = await audio.parakeet(models);
      if (!sidecar) throw new Error('no Parakeet sidecar');
      expect(await audio.parakeet(models)).toBe(sidecar);
      const loaded = await sidecar.request<{ argv: string[] }>('asr.load', {
        version: 'v3',
        encoderPrecision: 'int8',
      });
      const pcm = join(audio.store.root, 'asset', 'speech.wav');
      expect(await sidecar.request('asr.transcribe', { path: pcm, language: 'es' })).toMatchObject({
        ok: true,
        value: { text: pcm, words: [{ text: 'Hola' }] },
      });
      expect(loaded.ok && loaded.value.argv).toEqual([
        'serve',
        '--services',
        'asr',
        '--models',
        models,
        '--allow-root',
        audio.store.root,
        '--idle-exit',
        '120',
      ]);
    } finally {
      await audio.close();
    }
  });

  it('leaves Parakeet out when the helper is not there, and says so once', async () => {
    const { audio, logs, config } = runtime();
    process.env.TAALCUT_MAC_HELPER = join(config.userData, 'no-such-helper');
    try {
      expect(await audio.parakeet('/models/parakeet')).toBeUndefined();
      expect(await audio.parakeet('/models/parakeet')).toBeUndefined();
      expect(logs.filter((line) => line.includes('mac helper unavailable'))).toHaveLength(1);
    } finally {
      await audio.close();
    }
  });
});

/** A stand-in whisper-server a dead jobs process left: answers its health route under `secret`, prints its port. */
const LEFT_SERVER = [
  "const http = require('node:http');",
  'const secret = process.argv[1];',
  'const server = http.createServer((req, res) => res.writeHead(req.url === `/${secret}/health` ? 200 : 404).end());',
  "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
].join('\n');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('whisper-servers a previous jobs process left', () => {
  it('are stopped when the jobs process registers audio, before any whisper call (IX-F7)', async () => {
    const config = testConfig('jobs');
    // An owner that has exited, and the server it left in its own process group.
    const owner = spawn('/usr/bin/true');
    await new Promise((resolve) => owner.once('exit', resolve));
    const secret = 'ab'.repeat(16);
    const left = spawn(process.execPath, ['-e', LEFT_SERVER, secret], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    try {
      const port = Number(
        await new Promise<string>((resolve) => createInterface({ input: left.stdout }).once('line', resolve)),
      );
      const dir = join(config.userData, 'whisper-servers');
      mkdirSync(dir, { recursive: true });
      const record = join(dir, `${owner.pid}-${left.pid}.json`);
      writeFileSync(record, JSON.stringify({ owner: owner.pid, pid: left.pid, port, secret }));

      // Registration only: nothing here resolves the audio runtime or asks for whisper.
      registerAudioIndexing(createContainer(), config, {
        backends: async () => ['cpu'],
        onFallback: () => undefined,
        log: () => undefined,
      });
      await expect.poll(() => alive(left.pid!) || existsSync(record), { timeout: 10_000 }).toBe(false);
    } finally {
      if (left.pid !== undefined && alive(left.pid)) process.kill(left.pid, 'SIGKILL');
    }
  });
});
