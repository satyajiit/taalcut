// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's voice capture (P3-B6, core C-12): chunks in order into a private WAV, a header and hash on stop, the path
 * claimed once by the agent, cancel, the one-hour sweep, the ten-minute cap, the microphone permission, and both
 * routers answering through their contracts (a window never gets a path).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectRpc,
  newId,
  serveRpc,
  VOICE_CAPTURE_TTL_MS,
  voiceCaptureContract,
  voiceCaptureFilesContract,
} from '@taalcut/core';
import { electronMicrophone } from '../src/main/voice/electron-microphone';
import {
  microphonePermission,
  type MicrophoneAccess,
  type MicrophonePermission,
} from '../src/main/voice/microphone';
import { voiceCaptureFilesRouter, voiceCaptureRouter } from '../src/main/voice/voice-capture-router';
import { createVoiceCaptureStore, MAX_CAPTURE_MS } from '../src/main/voice/voice-capture-store';
import { pcmDurationMs, wavHeader } from '../src/main/voice/wav-header';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(now = { value: 1_000_000 }) {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-voice-capture-'));
  dirs.push(root);
  const dir = join(root, 'voice-consent', 'captures');
  const logs: string[] = [];
  const store = createVoiceCaptureStore({
    dir,
    clock: { now: () => now.value },
    log: (line) => logs.push(line),
  });
  return { dir, store, now, logs };
}

/** `ms` of a 16-bit ramp at 48 kHz, as the window sends it. */
function pcm(ms: number, seed = 0): Buffer {
  const samples = (48_000 * ms) / 1000;
  const bytes = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(((i + seed) % 2000) - 1000, i * 2);
  return bytes;
}

const consentId = newId<'VoiceConsent'>();

async function recorded(store: Awaited<ReturnType<typeof setup>>['store'], chunks: readonly Buffer[]) {
  const started = await store.start({ consentId, sampleRate: 48_000 });
  if (!started.ok) throw new Error(started.error.code);
  for (const [seq, chunk] of chunks.entries()) {
    const appended = await store.append({
      captureId: started.value,
      seq,
      pcmBase64: chunk.toString('base64'),
    });
    if (!appended.ok) throw new Error(appended.error.code);
  }
  return started.value;
}

describe('the voice capture store', () => {
  it('writes the chunks in order into a WAV with its header, length and hash, in a private folder', async () => {
    const { dir, store } = await setup();
    const chunks = [pcm(500), pcm(250, 7), pcm(250, 11)];
    const id = await recorded(store, chunks);
    expect(await readdir(dir)).toEqual([`${id}.wav.part`]);
    const stopped = await store.stop(id);
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    const file = await readFile(join(dir, `${id}.wav`));
    const data = Buffer.concat(chunks);
    expect(file).toEqual(
      Buffer.concat([wavHeader({ sampleRate: 48_000, channels: 1, bitsPerSample: 16 }, data.length), data]),
    );
    expect(file.toString('ascii', 0, 4)).toBe('RIFF');
    expect(file.readUInt32LE(24)).toBe(48_000);
    expect(stopped.value).toEqual({
      captureKey: id,
      durationMs: 1000,
      sha256: createHash('sha256').update(file).digest('hex'),
    });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, `${id}.wav`))).mode & 0o777).toBe(0o600);
  });

  it('refuses a chunk out of order, a repeat, odd bytes and an unknown capture', async () => {
    const { store } = await setup();
    const id = await recorded(store, [pcm(20)]);
    const gap = await store.append({ captureId: id, seq: 2, pcmBase64: pcm(20).toString('base64') });
    const repeat = await store.append({ captureId: id, seq: 0, pcmBase64: pcm(20).toString('base64') });
    const odd = await store.append({ captureId: id, seq: 1, pcmBase64: Buffer.alloc(3).toString('base64') });
    const unknown = await store.append({ captureId: newId<'VoiceCapture'>(), seq: 0, pcmBase64: '' });
    expect([gap, repeat, odd, unknown].map((r) => (r.ok ? 'ok' : r.error.code))).toEqual([
      'core.validation',
      'core.validation',
      'core.validation',
      'core.not_found',
    ]);
    // The refused chunks wrote nothing: seq 1 is still next.
    expect((await store.append({ captureId: id, seq: 1, pcmBase64: pcm(20).toString('base64') })).ok).toBe(
      true,
    );
    const stopped = await store.stop(id);
    expect(stopped.ok && stopped.value.durationMs).toBe(40);
  });

  it('refuses chunks past ten minutes', async () => {
    const { store } = await setup();
    const id = await recorded(store, []);
    const minute = pcm(60_000).toString('base64');
    for (let seq = 0; seq < MAX_CAPTURE_MS / 60_000; seq++)
      expect((await store.append({ captureId: id, seq, pcmBase64: minute })).ok).toBe(true);
    const over = await store.append({ captureId: id, seq: 10, pcmBase64: pcm(20).toString('base64') });
    expect(over.ok ? 'ok' : over.error.code).toBe('core.validation');
    const stopped = await store.stop(id);
    expect(stopped.ok && stopped.value.durationMs).toBe(MAX_CAPTURE_MS);
  });

  it('gives a stopped capture to one claim, never a recording one', async () => {
    const { dir, store } = await setup();
    const id = await recorded(store, [pcm(100)]);
    expect((await store.claim(id)).ok).toBe(false);
    await store.stop(id);
    const first = await store.claim(id);
    expect(first.ok && first.value).toEqual({ path: join(dir, `${id}.wav`) });
    const second = await store.claim(id);
    expect(second.ok ? 'ok' : second.error.code).toBe('core.not_found');
    expect((await store.cancel(id)).ok).toBe(false);
  });

  it('deletes a cancelled capture', async () => {
    const { dir, store } = await setup();
    const id = await recorded(store, [pcm(100)]);
    expect((await store.cancel(id)).ok).toBe(true);
    expect(await readdir(dir)).toEqual([]);
    expect((await store.stop(id)).ok).toBe(false);
  });

  it('counts as recording from start until stop or cancel, and no longer than ten minutes (SV-6)', async () => {
    const { store, now } = await setup();
    expect(store.isRecording()).toBe(false);
    const stopped = await recorded(store, [pcm(100)]);
    expect(store.isRecording()).toBe(true);
    expect((await store.stop(stopped)).ok).toBe(true);
    expect(store.isRecording()).toBe(false);
    const cancelled = await recorded(store, [pcm(100)]);
    expect(store.isRecording()).toBe(true);
    expect((await store.cancel(cancelled)).ok).toBe(true);
    expect(store.isRecording()).toBe(false);
    // A window that went away mid-recording never stops it: the grant ends with the longest recording allowed.
    await recorded(store, [pcm(100)]);
    now.value += MAX_CAPTURE_MS;
    expect(store.isRecording()).toBe(true);
    now.value += 1;
    expect(store.isRecording()).toBe(false);
  });

  it('sweeps unclaimed and unfinished captures after an hour, and leftovers of an earlier run', async () => {
    const { dir, store, now } = await setup();
    const unclaimed = await recorded(store, [pcm(100)]);
    await store.stop(unclaimed);
    const unfinished = await recorded(store, [pcm(100)]);
    const claimed = await recorded(store, [pcm(100)]);
    await store.stop(claimed);
    await store.claim(claimed);
    const leftover = join(dir, `${newId<'VoiceCapture'>()}.wav`);
    await writeFile(leftover, 'old');
    const old = new Date(now.value - VOICE_CAPTURE_TTL_MS - 1000);
    await utimes(leftover, old, old);
    // Something that isn't a capture is never main's to delete.
    await writeFile(join(dir, 'notes.txt'), 'keep');
    await utimes(join(dir, 'notes.txt'), old, old);

    expect((await store.sweep()).ok).toBe(true);
    expect((await readdir(dir)).sort()).toEqual(
      [`${claimed}.wav`, `${unclaimed}.wav`, `${unfinished}.wav.part`, 'notes.txt'].sort(),
    );

    now.value += VOICE_CAPTURE_TTL_MS + 1;
    // The next recording sweeps first: only the claimed file (the consent store's now) and other files stay.
    const fresh = await store.start({ consentId, sampleRate: 48_000 });
    expect(fresh.ok).toBe(true);
    expect((await readdir(dir)).sort()).toEqual(
      [`${claimed}.wav`, `${fresh.ok ? fresh.value : ''}.wav.part`, 'notes.txt'].sort(),
    );
    expect((await store.stop(unclaimed)).ok).toBe(false);
  });

  it('records only at 48 kHz', async () => {
    const { store } = await setup();
    const started = await store.start({ consentId, sampleRate: 44_100 });
    expect(started.ok ? 'ok' : started.error.code).toBe('core.validation');
  });

  it('measures PCM length in whole milliseconds', () => {
    expect(pcmDurationMs({ sampleRate: 48_000, channels: 1, bitsPerSample: 16 }, 96_000)).toBe(1000);
  });
});

function fakeMicrophone(initial: MicrophonePermission, grant: boolean) {
  let status = initial;
  let asked = 0;
  const microphone: MicrophoneAccess = {
    status: () => status,
    ask: async () => {
      asked += 1;
      status = grant ? 'granted' : 'denied';
      return grant;
    },
  };
  return { microphone, asked: () => asked };
}

describe('the microphone permission', () => {
  it('asks only while undecided', async () => {
    const undecided = fakeMicrophone('not-determined', true);
    expect(await microphonePermission(undecided.microphone)).toBe('granted');
    expect(undecided.asked()).toBe(1);
    const denied = fakeMicrophone('denied', true);
    expect(await microphonePermission(denied.microphone)).toBe('denied');
    expect(denied.asked()).toBe(0);
    const refused = fakeMicrophone('not-determined', false);
    expect(await microphonePermission(refused.microphone)).toBe('denied');
  });

  it("maps Electron's unknown to not determined and asks for the microphone", async () => {
    const asked: string[] = [];
    const microphone = electronMicrophone({
      getMediaAccessStatus: () => 'unknown',
      askForMediaAccess: async (media) => {
        asked.push(media);
        return true;
      },
    });
    expect(microphone.status()).toBe('not-determined');
    expect(await microphone.ask()).toBe(true);
    expect(asked).toEqual(['microphone']);
  });
});

function windowPort(router: ReturnType<typeof voiceCaptureRouter>): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(router, port1, { context: { caller: 'renderer' as const, webContentsId: 3 } });
  return port2;
}

function agentPort(router: ReturnType<typeof voiceCaptureFilesRouter>): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(router, port1, { context: { caller: 'agent' } });
  return port2;
}

describe('the voice capture routers', () => {
  it('record through appContract.voiceCapture and claim through the agent contract', async () => {
    const { store } = await setup();
    const { microphone } = fakeMicrophone('granted', true);
    const window = connectRpc(voiceCaptureContract, windowPort(voiceCaptureRouter(store, microphone)), {
      peer: 'main',
    }).client;
    const agent = connectRpc(voiceCaptureFilesContract, agentPort(voiceCaptureFilesRouter(store)), {
      peer: 'main',
    }).client;

    expect(await window.permission()).toBe('granted');
    const { captureId } = await window.start({ consentId, sampleRate: 48_000 });
    await window.append({ captureId, seq: 0, pcmBase64: pcm(200).toString('base64') });
    await expect(
      window.append({ captureId, seq: 5, pcmBase64: pcm(20).toString('base64') }),
    ).rejects.toMatchObject({ data: { code: 'core.validation' } });
    const stopped = await window.stop({ captureId });
    expect(stopped).toMatchObject({ captureKey: captureId, durationMs: 200 });
    expect(JSON.stringify(stopped)).not.toContain('/');

    const claimed = await agent.claim({ captureKey: stopped.captureKey });
    expect(claimed.path.endsWith(`${captureId}.wav`)).toBe(true);
    await expect(agent.claim({ captureKey: stopped.captureKey })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });
});
