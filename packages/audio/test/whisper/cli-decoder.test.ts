// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** whisper-cli per call, with a fake run: Metal first, `-ng` once when Metal fails, exits and cancel. */
import { writeFile } from 'node:fs/promises';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { WhisperRun } from '../../src/speech/detect';
import { createCliWhisperDecoder } from '../../src/whisper/cli-decoder';

const tokens = {
  result: { language: 'en' },
  transcription: [
    { tokens: [{ text: ' Hello', offsets: { from: 0, to: 400 }, p: 0.9, t_dtw: -1, id: 1 }], text: ' Hello' },
  ],
};

/** A run that writes `-ojf` output where `-of` says, and answers with each stderr/exit in turn. */
function fakeRun(answers: readonly { stderr: string; exitCode: number }[]) {
  const calls: string[][] = [];
  const run: WhisperRun = async (args) => {
    calls.push([...args]);
    const base = args[args.indexOf('-of') + 1];
    if (base) await writeFile(`${base}.json`, JSON.stringify(tokens));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? { stderr: '', exitCode: 0 };
    return ok({ stdout: '', ...answer });
  };
  return { run, calls };
}

const request = { model: '/models/ggml-tiny.bin', audio: '/tmp/a.wav', language: 'en' as const };

describe('createCliWhisperDecoder', () => {
  it('runs once more with -ng and logs the CPU fallback when Metal fails to start', async () => {
    const events: ComputeFallbackEvent[] = [];
    const { run, calls } = fakeRun([
      { stderr: 'ggml_metal_init: error: failed to create command queue', exitCode: 1 },
      { stderr: '', exitCode: 0 },
    ]);
    const decoder = createCliWhisperDecoder({
      binary: 'whisper-cli',
      run,
      onFallback: (e) => events.push(e),
    });
    const decoded = await decoder.transcribe(request);
    expect(decoded.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)).toBe('-ng');
    expect(events.map((event) => event.reason)).toEqual(['accelerator_failed']);
  });

  it('answers the tokens on Metal without a second run', async () => {
    const { run, calls } = fakeRun([{ stderr: '', exitCode: 0 }]);
    const decoded = await createCliWhisperDecoder({ binary: 'whisper-cli', run }).transcribe(request);
    expect(decoded.ok && decoded.value.language).toBe('en');
    expect(calls).toHaveLength(1);
  });

  it('fails the transcript on a non-zero exit that is not about Metal', async () => {
    const { run } = fakeRun([{ stderr: 'bad model file', exitCode: 2 }]);
    const decoded = await createCliWhisperDecoder({ binary: 'whisper-cli', run }).transcribe(request);
    expect(!decoded.ok && decoded.error.code).toBe('audio.transcription_failed');
  });

  it('does not run when the signal is already aborted', async () => {
    const { run, calls } = fakeRun([]);
    const decoded = await createCliWhisperDecoder({ binary: 'whisper-cli', run }).transcribe({
      ...request,
      signal: AbortSignal.abort(),
    });
    expect(!decoded.ok && decoded.error.code).toBe('core.cancelled');
    expect(calls).toHaveLength(0);
  });
});
