// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  callRpc,
  createCommandBus,
  createMemoryAuditLogStore,
  systemClock,
  TIMELINE_COMMANDS,
  timelineSchema,
  type GraphicItem,
  type Id,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { MEDIA_FIXTURE_IDS } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { mediaOptions } from '../src/backend/fake/options/media';
import { createFakeMediaCommands } from '../src/backend/fake/phase3/fake-media-commands';
import type { FakeVoiceCaptureOptions } from '../src/backend/fake/phase3/fake-voice-capture';

const CONSENT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZN' as Id<'VoiceConsent'>;
const ids = MEDIA_FIXTURE_IDS;
const [FIRST, SECOND] = ids.timelines;
const person = { source: 'ui', actor: 'user' } as const;

/** `seconds` of 48 kHz 16-bit silence as base64 chunks of a quarter second. */
function chunks(seconds: number): string[] {
  const chunk = btoa(String.fromCharCode(...new Uint8Array(24_000)));
  return Array.from({ length: Math.round(seconds * 4) }, () => chunk);
}

function setup(voiceCapture: FakeVoiceCaptureOptions = {}, localOnly = false) {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0 },
    phase3: { voiceCapture: { arranged: true, ...voiceCapture } },
  });
  // The media commands on a bus of their own with the timelines' restore (for undo), whether or not
  // fake-phase3.ts has registered them on the app's.
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
  const media = createFakeMediaCommands(
    { make: controls.make, localOnly: () => localOnly },
    controls.phase3.voiceCapture,
    voiceCapture,
  );
  bus.register(
    ...media.commands,
    ...controls.make.timelines.commands.filter((command) => command.name === TIMELINE_COMMANDS.restore),
  );
  const code = (result: Result<unknown>) => (result.ok ? 'ok' : result.error.code);
  const timeline = (id: Id<'Timeline'>): Timeline => {
    const found = controls.make.timelines.get(id);
    if (!found) throw new Error(`no timeline ${id}`);
    return found;
  };
  const graphic = (id: Id<'Timeline'>, itemId: string): GraphicItem | undefined => {
    for (const track of timeline(id).tracks)
      for (const item of track.kind === 'text' ? track.items : [])
        if (item.type === 'graphic' && item.id === itemId) return item;
    return undefined;
  };
  /** A whole capture through main's procedures: start, `seconds` of chunks, stop. */
  const record = async (seconds: number) => {
    const started = await callRpc(client.voiceCapture.start({ consentId: CONSENT, sampleRate: 48_000 }));
    if (!started.ok) throw new Error(started.error.code);
    const { captureId } = started.value;
    for (const [seq, pcmBase64] of chunks(seconds).entries())
      await callRpc(client.voiceCapture.append({ captureId, seq, pcmBase64 }));
    const stopped = await callRpc(client.voiceCapture.stop({ captureId }));
    if (!stopped.ok) throw new Error(stopped.error.code);
    return stopped.value;
  };
  return { client, controls, bus, media, code, timeline, graphic, record };
}

describe('the fake microphone capture (P3-B6)', () => {
  it('reports the permission, asking once while macOS has not asked', async () => {
    const { client } = setup({ permission: 'not-determined', answer: 'denied' });
    expect(await callRpc(client.voiceCapture.permission())).toEqual({ ok: true, value: 'denied' });
    expect(await callRpc(setup().client.voiceCapture.permission())).toEqual({ ok: true, value: 'granted' });
  });

  it('takes chunks in order only, of whole samples, and finishes as a key with its length and hash', async () => {
    const { client, controls, code, record } = setup();
    const started = await callRpc(client.voiceCapture.start({ consentId: CONSENT, sampleRate: 48_000 }));
    if (!started.ok) throw new Error(started.error.code);
    const { captureId } = started.value;
    const [chunk = ''] = chunks(0.25);
    expect(code(await callRpc(client.voiceCapture.append({ captureId, seq: 1, pcmBase64: chunk })))).toBe(
      'core.validation',
    );
    expect(
      code(await callRpc(client.voiceCapture.append({ captureId, seq: 0, pcmBase64: btoa('abc') }))),
    ).toBe('core.validation');
    expect(code(await callRpc(client.voiceCapture.append({ captureId, seq: 0, pcmBase64: chunk })))).toBe(
      'ok',
    );
    expect(controls.phase3.voiceCapture.captures.list()).toEqual([
      { id: captureId, state: 'recording', chunks: 1, bytes: 24_000 },
    ]);
    expect(code(await callRpc(client.voiceCapture.cancel({ captureId })))).toBe('ok');
    expect(code(await callRpc(client.voiceCapture.stop({ captureId })))).toBe('core.not_found');

    const stopped = await record(61);
    expect(stopped.durationMs).toBe(61_000);
    expect(stopped.sha256).toMatch(/^[0-9a-f]{64}$/);
    const late = await callRpc(
      client.voiceCapture.append({ captureId: stopped.captureKey, seq: 244, pcmBase64: chunk }),
    );
    expect(code(late)).toBe('core.not_found');
  });
});

describe('the fake consent commands (P3-B6)', () => {
  const recordConsent = (captureKey: string, termsVersion = '1') => ({
    projectId: null,
    consentId: CONSENT,
    captureKey,
    speakerName: 'Mira',
    language: 'en',
    termsVersion,
  });

  it('stores a consent from a stopped capture once, then clones, deletes and withdraws it', async () => {
    const { bus, media, code, record } = setup();
    const { captureKey } = await record(61);
    const stored = await bus.dispatch('voice.recordConsent', recordConsent(captureKey), person);
    expect(stored.ok && stored.value.result).toEqual({ consentId: CONSENT, phraseMatch: 0.96 });
    expect(media.consents()).toEqual([{ id: CONSENT, speakerName: 'Mira', clone: null }]);
    expect(code(await bus.dispatch('voice.recordConsent', recordConsent(captureKey), person))).toBe(
      'core.not_found',
    );
    const clone = await bus.dispatch(
      'voice.createClone',
      { projectId: null, consentId: CONSENT, name: 'Mira' },
      person,
    );
    expect(clone.ok && clone.value.result).toMatchObject({ requiresVerification: false });
    expect(
      code(await bus.dispatch('voice.deleteClone', { projectId: null, consentId: CONSENT }, person)),
    ).toBe('ok');
    expect(
      code(await bus.dispatch('voice.withdrawConsent', { projectId: null, consentId: CONSENT }, person)),
    ).toBe('ok');
    expect(media.consents()).toEqual([]);
  });

  it('refuses what audio refuses: short recordings, the line not heard, old terms, the agent, uploads under Local only', async () => {
    const short = setup();
    const brief = await short.record(30);
    const refused = await short.bus.dispatch('voice.recordConsent', recordConsent(brief.captureKey), person);
    expect(!refused.ok && refused.error).toMatchObject({
      code: 'audio.consent_recording_length',
      params: { seconds: 30 },
    });
    expect(short.code(await short.bus.dispatch('voice.recordConsent', recordConsent('x', '9'), person))).toBe(
      'core.validation',
    );
    const agent = { source: 'agent', actor: 'agent:test' } as const;
    expect(
      short.code(
        await short.bus.dispatch('voice.withdrawConsent', { projectId: null, consentId: CONSENT }, agent),
      ),
    ).toBe('core.command_source_refused');

    const misheard = setup({ heard: 'I am Mira and I agree to' });
    const mismatch = await misheard.bus.dispatch(
      'voice.recordConsent',
      recordConsent((await misheard.record(61)).captureKey),
      person,
    );
    expect(!mismatch.ok && mismatch.error).toMatchObject({
      code: 'audio.consent_mismatch',
      params: { heard: 'I am Mira and I agree to' },
    });

    const local = setup({}, true);
    await local.bus.dispatch(
      'voice.recordConsent',
      recordConsent((await local.record(61)).captureKey),
      person,
    );
    const upload = { projectId: null, consentId: CONSENT, name: 'Mira' };
    expect(local.code(await local.bus.dispatch('voice.createClone', upload, person))).toBe('core.local_only');
    const none = setup();
    expect(none.code(await none.bus.dispatch('voice.createClone', upload, person))).toBe(
      'audio.voice_consent_required',
    );
  });
});

describe('the fake graphics commands (P3-V13)', () => {
  const stalls = { projectId: ids.project, timelineId: FIRST, itemId: ids.graphics.halfTheStalls };

  it('rewords its design and moves it by a time anchor (clamped to the video), as one undo step each', async () => {
    const { bus, code, graphic, timeline } = setup();
    const before = timeline(FIRST);
    const original = graphic(FIRST, stalls.itemId);
    const params = { words: '75%' };
    expect(code(await bus.dispatch('graphics.edit', { ...stalls, params }, person))).toBe('ok');
    expect(graphic(FIRST, stalls.itemId)).toMatchObject({ composition: { params }, origin: 'user' });
    const anchor = { kind: 'time', at: { value: 100_000, rate: before.canvas.rate } };
    expect(code(await bus.dispatch('graphics.edit', { ...stalls, anchor }, person))).toBe('ok');
    const moved = graphic(FIRST, stalls.itemId);
    const length = before.tracks[0]?.items.reduce(
      (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
      0,
    );
    expect(moved && moved.start.value + moved.duration.value).toBe(length);
    expect(timelineSchema.safeParse(timeline(FIRST)).success).toBe(true);
    await bus.undo(ids.project, person);
    await bus.undo(ids.project, person);
    expect(graphic(FIRST, stalls.itemId)).toEqual(original);
  });

  it('refuses a move, a resize or a variable its design hasn’t, a graphic that isn’t there, a stale revision and an unknown timeline', async () => {
    const { bus, code, timeline } = setup();
    for (const change of [{ placement: 'bottom' }, { scale: 1.5 }, { params: { title: 'Mira' } }])
      expect(code(await bus.dispatch('graphics.edit', { ...stalls, ...change }, person))).toBe(
        'render.graphic_invalid',
      );
    const missing = { ...stalls, itemId: ids.graphics.nameCard };
    expect(code(await bus.dispatch('graphics.remove', missing, person))).toBe('core.not_found');
    const stale = { ...stalls, revision: timeline(FIRST).revision + 5 };
    expect(code(await bus.dispatch('graphics.remove', stale, person))).toBe('core.conflict');
    expect(code(await bus.dispatch('graphics.remove', { ...stalls, timelineId: SECOND }, person))).toBe(
      'core.not_found',
    );
    const unknown = { ...stalls, timelineId: '01K7C5M6Q8N0000000000000ZZ' };
    expect(code(await bus.dispatch('graphics.remove', unknown, person))).toBe('timeline.not_found');
  });

  it('removes a graphic, and undo puts it back where it was', async () => {
    const { bus, code, graphic } = setup();
    const before = graphic(FIRST, stalls.itemId);
    expect(code(await bus.dispatch('graphics.remove', stalls, person))).toBe('ok');
    expect(graphic(FIRST, stalls.itemId)).toBeUndefined();
    expect(code(await bus.undo(ids.project, person))).toBe('ok');
    expect(graphic(FIRST, stalls.itemId)).toEqual(before);
  });
});

describe('the media arrangement for /dev/kit', () => {
  it('puts each fixture’s voiceover, graphics and image slot on its Golden hour timeline, valid', () => {
    const { timeline } = setup();
    for (const n of [0, 1, 2] as const) {
      const arranged = timeline(ids.timelines[n]);
      expect(timelineSchema.safeParse(arranged).success).toBe(true);
      expect(arranged.voiceover?.id).toBe(ids.voiceovers[n]);
      const voice = arranged.tracks.find((track) => track.kind === 'audio' && track.role === 'voice');
      expect(voice?.items.filter((item) => item.type === 'clip').map((item) => item.id)).toEqual([
        ids.voiceClip(n, 0),
        ids.voiceClip(n, 1),
        ids.voiceClip(n, 2),
      ]);
    }
    const video = timeline(SECOND).tracks[0];
    const slot = video?.items.find((item) => 'slotId' in item && item.slotId === ids.imageSlot);
    expect(slot?.type).toBe('gap');
  });

  it('reads its options from taalcut.fake, keeping only what it knows', () => {
    expect(
      mediaOptions({ media: { microphone: 'denied', answer: 'maybe', arranged: true, heard: 'I am' } }),
    ).toEqual({ phase3: { voiceCapture: { permission: 'denied', arranged: true, heard: 'I am' } } });
    expect(mediaOptions({ media: 'yes' })).toEqual({});
  });
});
