// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { err, ok, toTaalcutError, type Id, type Result } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SAMPLES, createChunker, levelOf, pcmBase64, toPcm16 } from '../src/features/voice/pcm';
import {
  createVoiceRecorder,
  type MicrophoneInput,
  type OpenMicrophone,
  type VoiceCaptureApi,
} from '../src/features/voice/voice-recorder';

const CONSENT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZN' as Id<'VoiceConsent'>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** main's voiceCapture as a recording of what it was asked; `refuseAt` fails that chunk number. */
function capture(refuseAt = -1) {
  const appended: { seq: number; bytes: number }[] = [];
  const api: VoiceCaptureApi = {
    permission: vi.fn(() => Promise.resolve(ok('granted' as const))),
    start: vi.fn(() => Promise.resolve(ok({ captureId: 'capture-1' }))),
    append: vi.fn(({ seq, pcmBase64: data }) => {
      if (seq === refuseAt) return Promise.resolve(err(toTaalcutError(new Error('refused'))));
      appended.push({ seq, bytes: atob(data).length });
      return Promise.resolve(ok(null));
    }),
    stop: vi.fn(() => Promise.resolve(ok({ captureKey: 'capture-1', durationMs: 61_000 }))),
    cancel: vi.fn(() => Promise.resolve(ok(null))),
  };
  return { api, appended };
}

/** A microphone the test feeds; `opened` false makes getUserMedia refuse. */
function microphone(opened = true) {
  let feed: ((samples: Float32Array) => void) | null = null;
  let end: (() => void) | null = null;
  const input: MicrophoneInput = { close: vi.fn(() => Promise.resolve()) };
  const open: OpenMicrophone = vi.fn((onSamples, onEnded) => {
    feed = onSamples;
    end = onEnded;
    const result: Result<MicrophoneInput> = opened
      ? ok(input)
      : err(toTaalcutError(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })));
    return Promise.resolve(result);
  });
  return { open, input, feed: (samples: Float32Array) => feed?.(samples), end: () => end?.() };
}

const block = (length: number, value = 0.25) => new Float32Array(length).fill(value);

describe('voice recorder (P3-B6)', () => {
  it('sends quarter-second chunks to main in order, then the rest on stop, and keeps nothing', async () => {
    const main = capture();
    const mic = microphone();
    const levels: number[] = [];
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: mic.open });
    const started = await recorder.start({
      consentId: CONSENT,
      onLevel: (level) => levels.push(level),
      onFailed: vi.fn(),
    });
    if (!started.ok) throw new Error('did not start');
    expect(main.api.start).toHaveBeenCalledWith({ consentId: CONSENT, sampleRate: 48_000 });
    for (let i = 0; i < 6; i += 1) mic.feed(block(5_000));
    await settle();
    expect(main.appended.map((chunk) => chunk.seq)).toEqual([0, 1]);
    expect(main.appended.every((chunk) => chunk.bytes === CHUNK_SAMPLES * 2)).toBe(true);
    expect(levels).toHaveLength(6);
    expect(levels[0]).toBeGreaterThan(0.7);

    const stopped = await started.value.stop();
    expect(stopped).toEqual({ ok: true, value: { captureKey: 'capture-1', durationMs: 61_000 } });
    expect(main.appended.map((chunk) => chunk.seq)).toEqual([0, 1, 2]);
    expect(main.appended[2]?.bytes).toBe((30_000 - 2 * CHUNK_SAMPLES) * 2);
    expect(mic.input.close).toHaveBeenCalled();
    expect(main.api.cancel).not.toHaveBeenCalled();
  });

  it('cancel closes the microphone, stops sending and drops the capture in main', async () => {
    const main = capture();
    const mic = microphone();
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: mic.open });
    const started = await recorder.start({ consentId: CONSENT, onLevel: vi.fn(), onFailed: vi.fn() });
    if (!started.ok) throw new Error('did not start');
    mic.feed(block(CHUNK_SAMPLES));
    await started.value.cancel();
    mic.feed(block(CHUNK_SAMPLES));
    await settle();
    expect(main.api.cancel).toHaveBeenCalledWith({ captureId: 'capture-1' });
    expect(main.api.stop).not.toHaveBeenCalled();
    expect(main.appended).toHaveLength(1);
    expect(mic.input.close).toHaveBeenCalled();
  });

  it('a refused microphone (permission denied) drops main’s capture and says why', async () => {
    const main = capture();
    const mic = microphone(false);
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: mic.open });
    const started = await recorder.start({ consentId: CONSENT, onLevel: vi.fn(), onFailed: vi.fn() });
    expect(started.ok).toBe(false);
    expect(main.api.cancel).toHaveBeenCalledWith({ captureId: 'capture-1' });
  });

  it('asks main for the permission and passes its answer on', async () => {
    const main = capture();
    main.api.permission = vi.fn(() => Promise.resolve(ok('denied' as const)));
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: microphone().open });
    expect(await recorder.permission()).toEqual({ ok: true, value: 'denied' });
  });

  it('a chunk main refuses ends the recording: the microphone closes, main drops it, the card is told', async () => {
    const main = capture(1);
    const mic = microphone();
    const onFailed = vi.fn();
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: mic.open });
    const started = await recorder.start({ consentId: CONSENT, onLevel: vi.fn(), onFailed });
    if (!started.ok) throw new Error('did not start');
    for (let i = 0; i < 3; i += 1) mic.feed(block(CHUNK_SAMPLES));
    await settle();
    await settle();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(mic.input.close).toHaveBeenCalled();
    expect(main.api.cancel).toHaveBeenCalledWith({ captureId: 'capture-1' });
    expect(main.appended.map((chunk) => chunk.seq)).toEqual([0]);
    expect((await started.value.stop()).ok).toBe(false);
  });

  it('a send that throws ends the recording the same way, and nothing after it is sent', async () => {
    const main = capture();
    main.api.append = vi.fn(({ seq }) =>
      seq === 1 ? Promise.reject(new Error('the port closed')) : Promise.resolve(ok(null)),
    );
    const mic = microphone();
    const onFailed = vi.fn();
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: mic.open });
    const started = await recorder.start({ consentId: CONSENT, onLevel: vi.fn(), onFailed });
    if (!started.ok) throw new Error('did not start');
    for (let i = 0; i < 3; i += 1) mic.feed(block(CHUNK_SAMPLES));
    await settle();
    await settle();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(main.api.cancel).toHaveBeenCalledWith({ captureId: 'capture-1' });
    expect(main.api.append).toHaveBeenCalledTimes(2);
    expect((await started.value.stop()).ok).toBe(false);
  });

  it('a microphone that goes away mid-recording ends it the same way', async () => {
    const main = capture();
    const mic = microphone();
    const onFailed = vi.fn();
    const recorder = createVoiceRecorder({ capture: main.api, openMicrophone: mic.open });
    await recorder.start({ consentId: CONSENT, onLevel: vi.fn(), onFailed });
    mic.end();
    await settle();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(main.api.cancel).toHaveBeenCalled();
  });
});

it('narration stops exactly at the remaining film length and drops extra microphone blocks', async () => {
  const main = capture();
  const mic = microphone();
  const samples: Float32Array[] = [];
  const reached = vi.fn();
  const projectId = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>;
  const recorder = createVoiceRecorder({
    capture: main.api,
    openMicrophone: mic.open,
    onSamples: (chunk) => samples.push(chunk),
  });
  const started = await recorder.start({
    projectId,
    maxSamples: 13000,
    onLimit: reached,
    onLevel: vi.fn(),
    onFailed: vi.fn(),
  });
  if (!started.ok) throw new Error('did not start');
  expect(main.api.start).toHaveBeenCalledWith({ projectId, purpose: 'narration', sampleRate: 48_000 });
  mic.feed(block(10000));
  mic.feed(block(10000));
  mic.feed(block(10000));
  await started.value.stop();
  expect(reached).toHaveBeenCalledTimes(1);
  expect(samples.reduce((count, chunk) => count + chunk.length, 0)).toBe(13000);
  expect(main.appended.reduce((count, chunk) => count + chunk.bytes, 0)).toBe(26000);
});

describe('pcm', () => {
  it('writes 16-bit little-endian samples, clipped, in base64', () => {
    const pcm = toPcm16(new Float32Array([0, 1, -1, 2, -0.5]));
    expect([...pcm]).toEqual([0, 32767, -32768, 32767, -16384]);
    const bytes = [...atob(pcmBase64(pcm))].map((char) => char.charCodeAt(0));
    expect(bytes.slice(0, 6)).toEqual([0, 0, 0xff, 0x7f, 0x00, 0x80]);
  });

  it('meters silence as 0 and full scale as 1', () => {
    expect(levelOf(new Float32Array(128))).toBe(0);
    expect(levelOf(block(128, 1))).toBe(1);
  });

  it('chunks across blocks and flushes the remainder', () => {
    const chunks: number[] = [];
    const chunker = createChunker(4, (pcm) => chunks.push(pcm.length));
    chunker.push(block(3));
    chunker.push(block(6));
    chunker.flush();
    expect(chunks).toEqual([4, 4, 1]);
  });
});
