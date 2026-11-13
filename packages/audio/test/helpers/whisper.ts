// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * whisper.cpp for live tests: the binaries from tools/whisper/build.sh (or the env, or the developer component
 * cache) and the ggml models from the audio cache; '' for anything missing, so a suite can skip and say why.
 */
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const devCache = join(homedir(), 'Library', 'Caches', 'Taalcut-dev', 'components');
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

async function first(...paths: (string | undefined)[]): Promise<string> {
  for (const path of paths) {
    if (!path) continue;
    try {
      await access(path);
      return path;
    } catch {
      // Not here: the next candidate.
    }
  }
  return '';
}

export interface WhisperTools {
  readonly cli: string;
  readonly server: string;
  readonly tiny: string;
  readonly small: string;
  readonly vad: string;
}

export async function whisperTools(): Promise<WhisperTools> {
  const [cli, server, tiny, small, vad] = await Promise.all([
    first(
      process.env.TAALCUT_WHISPER_CLI,
      local('../../../../tools/whisper/dist/whisper-cli'),
      join(devCache, 'whisper-cli'),
    ),
    first(
      process.env.TAALCUT_WHISPER_SERVER,
      local('../../../../tools/whisper/dist/whisper-server'),
      join(devCache, 'whisper-server'),
    ),
    first(
      process.env.TAALCUT_WHISPER_TINY,
      local('../../.cache/whisper/ggml-tiny.bin'),
      join(devCache, 'ggml-tiny.bin'),
    ),
    first(
      process.env.TAALCUT_WHISPER_SMALL,
      local('../../.cache/whisper/ggml-small-q8_0.bin'),
      join(devCache, 'ggml-small-q8_0.bin'),
    ),
    first(local('../../.cache/silero-vad/silero_vad.onnx'), join(devCache, 'silero_vad.onnx')),
  ]);
  return { cli, server, tiny, small, vad };
}
