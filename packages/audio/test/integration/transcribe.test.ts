// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Live whisper on macOS `say` clips. Prints WER and RTF.
 * Those numbers are not a gate. A missing binary, model, or voice skips.
 */
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '@taalcut/media';
import { afterAll, describe, expect, it } from 'vitest';
import { rangeToMs } from '../../src/rates';
import { createWhisperEngine } from '../../src/speech/whisper-engine';
import { testMedia } from '../helpers/ffmpeg';

const tiny =
  process.env.TAALCUT_WHISPER_TINY ??
  fileURLToPath(new URL('../../.cache/whisper/ggml-tiny.bin', import.meta.url));
const small =
  process.env.TAALCUT_WHISPER_SMALL ??
  fileURLToPath(new URL('../../.cache/whisper/ggml-small-q8_0.bin', import.meta.url));
const binary =
  process.env.TAALCUT_WHISPER_CLI ??
  fileURLToPath(new URL('../../../../tools/whisper/dist/whisper-cli', import.meta.url));

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function wer(reference: readonly string[], hypothesis: readonly string[]): number {
  const rows = reference.length + 1;
  const cols = hypothesis.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return reference.length === 0 ? 0 : dp[reference.length]![hypothesis.length]! / reference.length;
}

interface SayCase {
  readonly label: string;
  readonly voice: string;
  readonly phrase: string;
  readonly language: string;
  readonly model: string;
  readonly modelName: string;
}

async function measureSay(dirs: string[], item: SayCase): Promise<void> {
  if (process.platform !== 'darwin') {
    console.warn(`${item.label}: skipped, say voices are macOS-only`);
    return;
  }
  if (!(await readable(binary)) || !(await readable(item.model))) {
    console.warn(`${item.label}: skipped, whisper-cli or ${item.modelName} is not present`);
    return;
  }
  const media = await testMedia(item.label);
  if (!media.ctx) return;
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-say-'));
  dirs.push(dir);
  const aiff = join(dir, 'phrase.aiff');
  const wav = join(dir, 'phrase.wav');
  const said = await runProcess('say', ['-v', item.voice, '-o', aiff, item.phrase]);
  if (!said.ok || said.value.exitCode !== 0) {
    console.warn(`${item.label}: skipped, ${item.voice} voice is not installed`);
    return;
  }
  const { runFfmpeg } = await import('@taalcut/media');
  const encoded = await runFfmpeg(media.ctx, [
    '-y',
    '-i',
    aiff,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    wav,
  ]);
  if (!encoded.ok) {
    console.warn(`${item.label}: skipped, ffmpeg could not encode the phrase (${encoded.error.code})`);
    return;
  }
  const info = await stat(wav);
  const audioSeconds = Math.max((info.size - 44) / 32_000, 0.001);
  const started = Date.now();
  const result = await createWhisperEngine({ binary, model: item.model }).transcribe(wav, {
    language: item.language,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const words = result.value.segments.flatMap((segment) =>
    segment.words.map((word) => word.text.toLowerCase()),
  );
  const score = wer(item.phrase.split(' '), words);
  const first = result.value.segments[0]?.words[0];
  const startMs = first ? rangeToMs(first.range).startMs : null;
  const seconds = (Date.now() - started) / 1000;
  console.warn(
    `${item.label} ${item.modelName} WER=${score.toFixed(3)} wordStartMs=${startMs ?? 'none'} rtf=${(seconds / audioSeconds).toFixed(3)} audioS=${audioSeconds.toFixed(3)} text=${words.join(' ')}`,
  );
  expect(result.value.engine).toBe('whisper');
}

describe('transcribe integration', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('prints English WER and RTF for Eddy when whisper-cli exists', async () => {
    await measureSay(dirs, {
      label: 'transcribe-en',
      voice: 'Eddy',
      phrase: 'one two three',
      language: 'en',
      model: tiny,
      modelName: 'tiny',
    });
  });

  it('prints Hindi WER and RTF for Lekha when the small model exists', async () => {
    await measureSay(dirs, {
      label: 'transcribe-hi',
      voice: 'Lekha',
      phrase: 'एक दो तीन',
      language: 'hi',
      model: small,
      modelName: 'small-q8_0',
    });
  });
});
