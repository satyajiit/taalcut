// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ElevenLabs as core's MusicProvider and SfxProvider (SPEC P3.2, P3.9 "B6/V6 clients"): the composition plan checked
 * before sending, `/v1/music/detailed`'s multipart answer split into the audio (byte for byte), the plan and the
 * `song-id`; Free refused with `models.plan_required`; sound effects with their `character-cost` credits on the row.
 */
import type { CompositionChunk, MusicRequest } from '@taalcut/core';
import {
  createElevenLabsMusic,
  createElevenLabsSfx,
  disableNetwork,
  type NetworkGuard,
} from '@taalcut/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { elevenLabsHarness, FAKE_MP3, fixture, multipartBody } from './support/elevenlabs-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const chunk = (durationMs: number, text = 'hook'): CompositionChunk => ({
  text,
  durationMs,
  positiveStyles: ['96 BPM', '4/4', 'instrumental'],
  negativeStyles: ['vocals', 'tempo change'],
});

const PLAN: MusicRequest = {
  plan: { kind: 'chunks', chunks: [chunk(8_000), chunk(24_000, 'body'), chunk(6_000, 'outro')] },
  seed: 7,
  signWithC2pa: true,
};

const BOUNDARY = 'song-boundary-1';
const detailedAnswer = () => ({
  bytes: multipartBody(BOUNDARY, [
    {
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify(fixture('music-detailed-json-part'))),
    },
    { headers: { 'content-type': 'audio/mpeg', 'content-disposition': 'attachment' }, body: FAKE_MP3 },
  ]),
  headers: { 'content-type': `multipart/mixed; boundary=${BOUNDARY}`, 'song-id': 'song_01HZX' },
});

describe('ElevenLabs music', () => {
  it('sends the v2 plan with c2pa and seed, and keeps the audio part byte for byte with its song id', async () => {
    const { wire, calls, session } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    wire.script('POST /v1/music/detailed', detailedAnswer());
    const music = createElevenLabsMusic({ session });
    const made = await music.compose(PLAN);
    if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
    const sent = wire.requests[1];
    expect(sent?.query).toEqual({ output_format: 'mp3_48000_192' });
    expect(sent?.json).toEqual({
      model_id: 'music_v2_5',
      sign_with_c2pa: true,
      seed: 7,
      composition_plan: {
        chunks: [
          {
            text: 'hook',
            duration_ms: 8000,
            positive_styles: ['96 BPM', '4/4', 'instrumental'],
            negative_styles: ['vocals', 'tempo change'],
          },
          expect.objectContaining({ duration_ms: 24000 }),
          expect.objectContaining({ duration_ms: 6000 }),
        ],
      },
    });
    expect(Buffer.from(made.value.bytes).equals(Buffer.from(FAKE_MP3))).toBe(true);
    expect(made.value).toMatchObject({
      mediaType: 'audio/mpeg',
      model: 'music_v2_5',
      songId: 'song_01HZX',
      estimated: true,
      // Asked to sign, but no reader to check it with.
      c2pa: 'unknown',
    });
    // 38 s at the PRD's US$0.15 a minute.
    expect(made.value.costUsd).toBeCloseTo(0.095, 10);
    expect(calls.records[1]).toMatchObject({ module: 'music', billed: { unit: 'second', quantity: 38 } });
  });

  it('sends a prompt with its length and instrumental flag', async () => {
    const { wire, session } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    wire.script('POST /v1/music/detailed', detailedAnswer());
    const music = createElevenLabsMusic({ session });
    const made = await music.compose({
      plan: { kind: 'prompt', prompt: 'calm lo-fi, 80 BPM', lengthMs: 30_000, instrumental: true },
      signWithC2pa: false,
    });
    expect(made.ok).toBe(true);
    expect(wire.requests[1]?.json).toEqual({
      model_id: 'music_v2_5',
      sign_with_c2pa: false,
      prompt: 'calm lo-fi, 80 BPM',
      music_length_ms: 30_000,
      force_instrumental: true,
    });
  });

  it.each([
    [
      'a chunk under 3 s',
      { ...PLAN, plan: { kind: 'chunks', chunks: [chunk(2_999)] } },
      'chunks[0].duration_ms',
    ],
    [
      'a chunk over 120 s',
      { ...PLAN, plan: { kind: 'chunks', chunks: [chunk(120_001)] } },
      'chunks[0].duration_ms',
    ],
    ['31 chunks', { ...PLAN, plan: { kind: 'chunks', chunks: new Array(31).fill(chunk(3_000)) } }, 'chunks'],
    [
      'over 600 s in all',
      { ...PLAN, plan: { kind: 'chunks', chunks: new Array(6).fill(chunk(110_000)) } },
      'chunks',
    ],
    ['no chunks', { ...PLAN, plan: { kind: 'chunks', chunks: [] } }, 'chunks'],
    [
      'a long chunk text',
      { ...PLAN, plan: { kind: 'chunks', chunks: [chunk(5_000, 'x'.repeat(201))] } },
      'chunks[0].text',
    ],
    [
      'a prompt with a seed',
      {
        plan: { kind: 'prompt', prompt: 'x', lengthMs: 10_000, instrumental: true },
        seed: 1,
        signWithC2pa: false,
      },
      'seed',
    ],
    [
      'a prompt over 600 s',
      { plan: { kind: 'prompt', prompt: 'x', lengthMs: 600_001, instrumental: true }, signWithC2pa: false },
      'music_length_ms',
    ],
  ] as [string, MusicRequest, string][])('refuses %s before sending', async (_name, request, field) => {
    const { wire, calls, session } = elevenLabsHarness();
    const made = await createElevenLabsMusic({ session }).compose(request);
    expect(!made.ok && made.error.code).toBe('models.music_plan_invalid');
    expect(!made.ok && made.error.params).toEqual({ field });
    expect(wire.requests).toHaveLength(0);
    expect(calls.records).toHaveLength(0);
  });

  it('refuses music on the Free plan without asking for it, and then says plan_required', async () => {
    const { wire, calls, session } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', { json: fixture('subscription-free') });
    const music = createElevenLabsMusic({ session });
    expect(music.available()).toEqual({ ok: true });
    const made = await music.compose(PLAN);
    expect(!made.ok && made.error.code).toBe('models.plan_required');
    expect(!made.ok && made.error.params).toEqual({ provider: 'elevenlabs', feature: 'music' });
    expect(wire.requests.map((r) => r.path)).toEqual(['/v1/user/subscription']);
    expect(calls.records).toHaveLength(1);
    expect(music.available()).toEqual({ ok: false, reason: 'plan_required' });
  });

  it('uses the standard format when the plan cannot be read, and the row says why', async () => {
    const { wire, calls, session } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', {
      status: 401,
      json: { detail: { status: 'missing_permissions', message: 'The API key lacks user_read.' } },
    });
    wire.script('POST /v1/music/detailed', detailedAnswer());
    const made = await createElevenLabsMusic({ session }).compose(PLAN);
    expect(made.ok).toBe(true);
    expect(wire.requests[1]?.query.output_format).toBe('mp3_44100_128');
    expect(calls.records.map((r) => r.outcome)).toEqual(['error', 'ok']);
    expect(calls.records[0]?.errorCode).toBe('models.auth_invalid');
  });

  it('is a provider error when the answer has no audio part', async () => {
    const { wire, session } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    wire.script('POST /v1/music/detailed', {
      bytes: multipartBody(BOUNDARY, [
        { headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{}') },
      ]),
      headers: { 'content-type': `multipart/mixed; boundary="${BOUNDARY}"` },
    });
    const made = await createElevenLabsMusic({ session }).compose(PLAN);
    expect(!made.ok && made.error.code).toBe('models.provider_error');
  });
});

describe('ElevenLabs sound effects', () => {
  it('sends the effect on eleven_text_to_sound_v2 and records the character-cost credits', async () => {
    const { wire, calls, session } = elevenLabsHarness();
    wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    wire.script('POST /v1/sound-generation', {
      bytes: FAKE_MP3,
      headers: { 'content-type': 'audio/mpeg', 'character-cost': '88' },
    });
    const sfx = createElevenLabsSfx({ session });
    const made = await sfx.generate({
      text: 'a short whoosh',
      durationSeconds: 2,
      loop: false,
      promptInfluence: 0.3,
    });
    if (!made.ok) throw new Error(made.error.code);
    expect(wire.requests[1]?.json).toEqual({
      text: 'a short whoosh',
      model_id: 'eleven_text_to_sound_v2',
      duration_seconds: 2,
      loop: false,
      prompt_influence: 0.3,
    });
    expect(Buffer.from(made.value.bytes).equals(Buffer.from(FAKE_MP3))).toBe(true);
    expect(made.value).toMatchObject({ model: 'eleven_text_to_sound_v2', c2pa: 'absent' });
    expect(made.value.costUsd).toBeCloseTo(0.004, 10);
    expect(calls.records[1]).toMatchObject({ module: 'music', billed: { unit: 'credit', quantity: 88 } });
  });

  it('checks duration, text and influence before sending', async () => {
    const { wire, session } = elevenLabsHarness();
    const sfx = createElevenLabsSfx({ session });
    for (const bad of [
      { text: 'x', durationSeconds: 0.4, loop: false, promptInfluence: 0.3 },
      { text: 'x', durationSeconds: 31, loop: false, promptInfluence: 0.3 },
      { text: ' ', durationSeconds: 2, loop: false, promptInfluence: 0.3 },
      { text: 'x', durationSeconds: 2, loop: false, promptInfluence: 1.5 },
    ]) {
      const made = await sfx.generate(bad);
      expect(!made.ok && made.error.code).toBe('core.validation');
    }
    expect(wire.requests).toHaveLength(0);
  });
});
