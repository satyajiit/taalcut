// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { gpuLine, progressOf, whisperServerArgs } from '../../src/whisper/server-args';
import { decodedOf, tokensOf, topLanguage, verboseJsonSchema } from '../../src/whisper/server-response';

const address = { port: 41234, secret: 'ab'.repeat(16), noPublic: '/work/no-public' };

describe('whisper-server arguments', () => {
  it('serves on loopback under the random path, with the CLI path decoding settings', () => {
    const args = whisperServerArgs(
      { binary: 'whisper-server', model: '/m/ggml-medium-q5_0.bin', gpu: true },
      address,
    );
    expect(args.join(' ')).toBe(
      `-m /m/ggml-medium-q5_0.bin --host 127.0.0.1 --port 41234 --request-path /${address.secret} ` +
        '--public /work/no-public -bs 5 -bo 5 -ml 1000000 -pp',
    );
  });

  it('runs small with DTW and flash attention off, and the CPU with -ng', () => {
    const args = whisperServerArgs(
      { binary: 'whisper-server', model: '/m/ggml-small-q8_0.bin', gpu: false },
      address,
    );
    expect(args.slice(-4)).toEqual(['-nfa', '--dtw', 'small', '-ng']);
  });

  it('reads progress and the GPU whisper.cpp chose from its log', () => {
    expect(progressOf('whisper_print_progress_callback: progress =  45%')).toBeCloseTo(0.45);
    expect(progressOf('whisper_init_state: kv self size')).toBeUndefined();
    expect(gpuLine('whisper_backend_init_gpu: using Metal backend')).toBe('gpu');
    expect(gpuLine('whisper_backend_init_gpu: no GPU found')).toBe('cpu');
    expect(gpuLine('whisper_model_load: loading model')).toBeUndefined();
  });
});

describe('whisper-server answers', () => {
  const json = verboseJsonSchema.parse({
    language: 'hindi',
    segments: [
      {
        words: [
          { word: ' नम', start: 0.42, end: 0.6, probability: 0.7, t_dtw: 51 },
          { word: 'स्ते', start: 0.6, end: 0.9, probability: null, t_dtw: -1 },
        ],
      },
      {},
    ],
    language_probabilities: { hi: 0.61, ur: 0.3, en: 0.02 },
  });

  it('maps words to the tokens the CLI gives, in milliseconds', () => {
    expect(tokensOf(json)).toEqual([
      { text: ' नम', fromMs: 420, toMs: 600, probability: 0.7, dtwMs: 510 },
      { text: 'स्ते', fromMs: 600, toMs: 900 },
    ]);
  });

  it('takes the most likely language, and keeps the asked one when there was one', () => {
    expect(topLanguage(json)).toEqual({ language: 'hi', probability: 0.61 });
    expect(decodedOf(json, 'auto').language).toBe('hi');
    expect(decodedOf(json, 'en').language).toBe('en');
    expect(topLanguage(verboseJsonSchema.parse({}))).toBeNull();
  });
});
