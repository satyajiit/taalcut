// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCommandBus,
  createMemoryAuditLogStore,
  err,
  newId,
  NotFoundError,
  ok,
  VOICE_CONSENT_COMMANDS,
  VOICE_CONSENT_TERMS_VERSION,
  type VoiceConsent,
  type VoiceConsentId,
  type VoiceConsentStore,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeFloatWav } from '../../src/pcm/pcm';
import { createConsentCommands } from '../../src/voice/consent-commands';
import { consentLine } from '../../src/voice/consent-lines';
import { matchConsent } from '../../src/voice/consent';
import { AGENT, MCP, UI } from '../helpers/bus';
import { fakeVoiceProvider } from '../helpers/voice';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-consent-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A 16-bit-free float WAV of `seconds` of quiet tone: what main's capture writes, as far as the header goes. */
async function recording(name: string, seconds: number): Promise<string> {
  const data = new Float32Array(seconds * 8000).map((_, i) => 0.01 * Math.sin(i / 3));
  const path = join(dir, `${name}.wav`);
  await writeFile(path, encodeFloatWav({ sampleRate: 8000, channels: [data] }));
  return path;
}

function memoryConsents() {
  const rows = new Map<VoiceConsentId, VoiceConsent>();
  const files = new Map<VoiceConsentId, string>();
  const claimed = new Map<string, string>();
  const store: VoiceConsentStore & { rows: typeof rows; files: typeof files; claimed: typeof claimed } = {
    rows,
    files,
    claimed,
    get: async (id) => ok(rows.get(id) ?? null),
    list: async () => ok([...rows.values()]),
    recordingPath: async (id) => {
      const path = files.get(id);
      return path ? ok(path) : err(NotFoundError({ entity: 'recording', id }));
    },
    put: async (consent, recording) => {
      rows.set(consent.id, consent);
      files.set(consent.id, claimed.get(recording.captureKey) ?? '');
      return ok(undefined);
    },
    setClone: async (id, clone) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, clone });
      return ok(undefined);
    },
    delete: async (id) => {
      rows.delete(id);
      files.delete(id);
      return ok(undefined);
    },
  };
  return store;
}

function setup(heard: (path: string) => string) {
  const consents = memoryConsents();
  const provider = fakeVoiceProvider();
  const transcribed: string[] = [];
  const commands = createConsentCommands({
    consents,
    provider,
    clock: { now: () => 9 },
    captures: {
      claim: async (key) => {
        const path = consents.claimed.get(key);
        return path ? ok({ path }) : err(NotFoundError({ entity: 'capture', id: key }));
      },
    },
    transcriber: {
      transcribe: async (path) => {
        transcribed.push(path);
        return ok(heard(path));
      },
    },
  });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: { now: () => 9 } });
  bus.register(...commands.all);
  return { consents, provider, bus, transcribed };
}

const NAME = 'Asha Rao';

async function record(env: ReturnType<typeof setup>, seconds = 75) {
  const captureKey = newId<'VoiceCapture'>();
  env.consents.claimed.set(captureKey, await recording(captureKey, seconds));
  const consentId = newId<'VoiceConsent'>();
  const payload = {
    consentId,
    captureKey,
    speakerName: NAME,
    language: 'en',
    termsVersion: VOICE_CONSENT_TERMS_VERSION,
  };
  return { consentId, result: await env.bus.dispatch(VOICE_CONSENT_COMMANDS.recordConsent, payload, UI) };
}

describe('cloning is impossible without a stored consent recording (P3-B6)', () => {
  it('refuses a clone with no consent, and the provider sees no call', async () => {
    const env = setup(() => '');
    const cloned = await env.bus.dispatch(
      VOICE_CONSENT_COMMANDS.createClone,
      { consentId: newId<'VoiceConsent'>(), name: 'Me' },
      UI,
    );
    expect(cloned.ok ? 'ok' : cloned.error.code).toBe('audio.voice_consent_required');
    expect(env.provider.clones).toEqual([]);
  });

  it('stores a consent whose recording says the line, then clones exactly that recording', async () => {
    const env = setup(() => `${consentLine('en', NAME)} And then I keep reading for a minute.`);
    const { consentId, result } = await record(env);
    expect(result.ok).toBe(true);
    expect(env.consents.rows.get(consentId)?.phraseMatch).toBe(1);
    const cloned = await env.bus.dispatch(VOICE_CONSENT_COMMANDS.createClone, { consentId, name: 'Me' }, UI);
    expect(cloned.ok).toBe(true);
    expect(env.provider.clones).toEqual([{ consentId, recordingPath: env.consents.files.get(consentId) }]);
    expect(env.consents.rows.get(consentId)?.clone?.voiceId).toBe('clone-1');
  });

  it('refuses a recording whose transcript misses the line, and stores nothing', async () => {
    const env = setup(() => 'Hello there, this is just me talking about my day and nothing else at all.');
    const { consentId, result } = await record(env);
    expect(result.ok ? 'ok' : result.error.code).toBe('audio.consent_mismatch');
    expect(env.consents.rows.has(consentId)).toBe(false);
  });

  it('refuses a recording under 60 s before transcribing it', async () => {
    const env = setup(() => consentLine('en', NAME));
    const { result } = await record(env, 20);
    expect(result.ok ? 'ok' : result.error.code).toBe('audio.consent_recording_length');
    expect(env.transcribed).toEqual([]);
  });

  it('refuses a clone from any other file than the consent recording', async () => {
    const env = setup(() => consentLine('en', NAME));
    const { consentId } = await record(env);
    env.consents.files.set(consentId, await recording('dropped-file', 70));
    const cloned = await env.bus.dispatch(VOICE_CONSENT_COMMANDS.createClone, { consentId, name: 'Me' }, UI);
    expect(cloned.ok ? 'ok' : cloned.error.code).toBe('audio.clone_source_refused');
    expect(env.provider.clones).toEqual([]);
  });

  it('refuses the agent and MCP clients for every consent command', async () => {
    const env = setup(() => consentLine('en', NAME));
    const { consentId } = await record(env);
    for (const origin of [AGENT, MCP]) {
      const cloned = await env.bus.dispatch(
        VOICE_CONSENT_COMMANDS.createClone,
        { consentId, name: 'Me' },
        origin,
      );
      expect(cloned.ok ? 'ok' : cloned.error.code).toBe('core.command_source_refused');
      const withdrawn = await env.bus.dispatch(VOICE_CONSENT_COMMANDS.withdrawConsent, { consentId }, origin);
      expect(withdrawn.ok ? 'ok' : withdrawn.error.code).toBe('core.command_source_refused');
    }
    expect(env.provider.clones).toEqual([]);
  });

  it('withdrawing deletes the provider voice, the consent and the recording', async () => {
    const env = setup(() => consentLine('en', NAME));
    const { consentId } = await record(env);
    await env.bus.dispatch(VOICE_CONSENT_COMMANDS.createClone, { consentId, name: 'Me' }, UI);
    const withdrawn = await env.bus.dispatch(VOICE_CONSENT_COMMANDS.withdrawConsent, { consentId }, UI);
    expect(withdrawn.ok).toBe(true);
    expect(env.provider.deleted).toEqual(['clone-1']);
    expect(env.consents.rows.has(consentId)).toBe(false);
    expect(env.consents.files.has(consentId)).toBe(false);
  });
});

describe('the consent line check', () => {
  it('needs the speaker name and 0.85 token similarity, in Hindi too', () => {
    expect(matchConsent(consentLine('en', NAME), 'en', NAME).ok).toBe(true);
    expect(matchConsent(consentLine('en', 'Someone Else'), 'en', NAME).ok).toBe(false);
    const hindi = consentLine('hi', 'आशा');
    expect(matchConsent(hindi, 'hi', 'आशा').ok).toBe(true);
    expect(matchConsent(hindi.split(' ').slice(0, 6).join(' '), 'hi', 'आशा').ok).toBe(false);
  });
});
