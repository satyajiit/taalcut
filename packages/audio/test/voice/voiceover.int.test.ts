// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createHash } from 'node:crypto';
import { FrameRate, newId, RationalTime, transcriptSchema, VOICE_COMMANDS, type SlotId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { beforeAll, describe, expect, it } from 'vitest';
import { trackOfRole } from '../../src/commands/audio-track';
import { createTimeStretcher } from '../../src/stretch/select';
import { createVoiceCommands } from '../../src/voice/voice-commands';
import { createVoiceoverService } from '../../src/voice/voiceover';
import { busWith, memoryTimelineStore, UI } from '../helpers/bus';
import { testMedia } from '../helpers/ffmpeg';
import { memorySink } from '../helpers/sinks';
import { makeTestTimeline, steadyBeatMap } from '../helpers/timeline';
import { fakeVoiceProvider } from '../helpers/voice';

let media: MediaContext;
const found = await testMedia('voiceover');
if (!found.ctx) console.warn(found.skip);

beforeAll(async () => {
  if (!found.ctx) return;
  media = found.ctx;
});

const MS = FrameRate.of(1000, 1);
const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()] as SlotId[];
const SCRIPT = [
  { text: 'Three things nobody tells you.' },
  { text: 'First, the rhythm matters more than the cut.' },
  { text: 'Follow for more.' },
];

async function setup(options: Parameters<typeof fakeVoiceProvider>[0] = {}) {
  const stretcher = await createTimeStretcher({ media });
  if (!stretcher.ok) throw new Error('stretcher');
  const timeline = makeTestTimeline({
    rate: FrameRate.of(30),
    clips: slots.map((slotId) => ({ frames: 120, slotId })),
    beatMap: steadyBeatMap(120, 13),
  });
  const provider = fakeVoiceProvider(options);
  const sink = memorySink();
  const service = createVoiceoverService({
    provider,
    sink,
    stretcher: stretcher.value,
    media,
    clock: { now: () => 5 },
    seed: () => 42,
  });
  const store = memoryTimelineStore(timeline);
  const { bus } = busWith(store, (deps) => createVoiceCommands(deps).all);
  return { timeline, provider, sink, service, store, bus };
}

describe.skipIf(!found.ctx)('a script becomes a placed, beat-aware voiceover (P3-B6)', () => {
  it('generates drafts, places them on beats on A2 and applies them undoably', async () => {
    const { timeline, provider, sink, service, store, bus } = await setup();
    const made = await service.generate({
      timeline,
      script: SCRIPT,
      voice: { voiceId: 'v1', voiceName: 'Test', own: false },
      language: 'en',
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(provider.requests.map((r) => r.quality)).toEqual(['draft', 'draft', 'draft']);
    expect(new Set(provider.requests.map((r) => r.seed))).toEqual(new Set([42]));
    expect(provider.requests[1]?.previousText).toBe(SCRIPT[0]?.text);
    expect(provider.requests[1]?.nextText).toBe(SCRIPT[2]?.text);
    expect(made.value.lines.every((l) => !l.offBeat)).toBe(true);

    const applied = await bus.dispatch(VOICE_COMMANDS.applyVoiceover, made.value.payload, UI);
    expect(applied.ok).toBe(true);
    const after = store.current(timeline.id);
    const voice = trackOfRole(after, 'voice');
    expect(voice?.id).toBe('A2');
    const clips = voice?.items.filter((i) => i.type === 'clip') ?? [];
    expect(clips).toHaveLength(3);
    expect(after.voiceover?.lines.map((l) => l.clipId)).toEqual(clips.map((c) => c.id));
    // Each clip's onset (half a frame into it) sits within a frame of a beat.
    const beatsMs = (after.beatMap?.beats ?? []).map((b) => RationalTime.toSeconds(b) * 1000);
    let at = 0;
    for (const item of voice?.items ?? []) {
      if (item.type === 'clip') {
        const onsetMs = (at + 0.5) * (1000 / 30);
        expect(Math.min(...beatsMs.map((b) => Math.abs(b - onsetMs)))).toBeLessThanOrEqual(1000 / 30);
      }
      if (item.type !== 'transition') at += item.duration.value;
    }
    // The provider's bytes are stored byte for byte.
    const stored = [...sink.files.values()].map((f) => createHash('sha256').update(f.bytes).digest('hex'));
    expect(stored).toHaveLength(3);
    expect(
      [...sink.files.values()].every(
        (f) => f.provenance.kind === 'generated' && f.provenance.quality === 'draft',
      ),
    ).toBe(true);

    // Each file carries its line's exact words as its transcript (engine 'tts'), so indexing won't transcribe it.
    const said = [...sink.files.values()].map((f) => f.transcript?.segments.map((seg) => seg.text).join(' '));
    expect(said).toEqual(SCRIPT.map((line) => line.text.replace(/[.,]/g, '')));
    expect([...sink.files.values()].every((f) => transcriptSchema.safeParse(f.transcript).success)).toBe(
      true,
    );
    expect([...sink.files.values()].every((f) => f.transcript?.engine === 'tts')).toBe(true);

    await bus.undo(timeline.projectId, UI);
    expect(trackOfRole(store.current(timeline.id), 'voice')).toBeNull();
    expect(store.current(timeline.id).voiceover).toBeNull();
    await bus.redo(timeline.projectId, UI);
    expect(store.current(timeline.id).voiceover?.lines).toHaveLength(3);
  });

  it('finalises every draft once on the final model, same text and seed; a later edit goes to final', async () => {
    const { timeline, provider, service, store, bus } = await setup();
    const made = await service.generate({
      timeline,
      script: SCRIPT,
      voice: { voiceId: 'v1', voiceName: 'Test', own: false },
      language: 'en',
    });
    if (!made.ok) throw new Error(made.error.code);
    await bus.dispatch(VOICE_COMMANDS.applyVoiceover, made.value.payload, UI);
    provider.requests.length = 0;
    const final = await service.finalize({ timeline: store.current(timeline.id) });
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(provider.requests.map((r) => [r.quality, r.text, r.seed])).toEqual(
      SCRIPT.map((l) => ['final', l.text, 42]),
    );
    await bus.dispatch(
      VOICE_COMMANDS.applyVoiceover,
      { ...final.value.payload, revision: store.current(timeline.id).revision },
      UI,
    );
    provider.requests.length = 0;
    const again = await service.finalize({ timeline: store.current(timeline.id) });
    expect(again.ok && provider.requests).toEqual([]);
    const lineId = store.current(timeline.id).voiceover?.lines[1]?.id;
    if (!lineId) throw new Error('no line');
    const edited = await service.editLine({
      timeline: store.current(timeline.id),
      lineId,
      text: 'First, rhythm beats the cut.',
    });
    expect(edited.ok).toBe(true);
    expect(provider.requests.map((r) => [r.quality, r.text])).toEqual([
      ['final', 'First, rhythm beats the cut.'],
    ]);
  });

  it('gives script_too_long instead of squeezing a line by more than 8 %', async () => {
    const { timeline, service } = await setup({ perChar: 0.09 });
    const made = await service.generate({
      timeline,
      script: [
        {
          text: 'This line is far too long to say inside a four second slot, however fast anyone reads it aloud.',
        },
        { text: 'Two.' },
        { text: 'Three.' },
      ],
      voice: { voiceId: 'v1', voiceName: 'Test', own: false },
      language: 'en',
    });
    expect(made.ok ? 'ok' : made.error.code).toBe('audio.script_too_long');
  });

  it('compresses a slightly long line into a new FLAC asset and keeps the original', async () => {
    const { timeline, sink, service } = await setup();
    // 69 spoken characters × 60 ms = 4.14 s from the first beat (the slot's start, so no pre-lap) in a 4 s slot
    // whose next slot is voiced: over by 3.5 %, so it is compressed to 0.966.
    const made = await service.generate({
      timeline,
      script: [
        { text: 'Keep the voice clear and the music low for every single short cut now.' },
        { text: 'Two.' },
        { text: 'Three.' },
      ],
      voice: { voiceId: 'v1', voiceName: 'Test', own: false },
      language: 'en',
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.warnings.some((w) => w.includes('compressed'))).toBe(true);
    const types = [...sink.files.values()].map((f) => f.mediaType);
    expect(types).toContain('audio/flac');
    expect(types.filter((t) => t === 'audio/wav')).toHaveLength(3);
    // The compressed file says the same words, each sooner by the compression ratio.
    const files = [...sink.files.values()];
    const words = (f: (typeof files)[number] | undefined) => f?.transcript?.segments[0]?.words ?? [];
    const original = words(files.find((f) => f.mediaType === 'audio/wav'));
    const squeezed = words(files.find((f) => f.mediaType === 'audio/flac'));
    expect(squeezed.map((w) => w.text)).toEqual(original.map((w) => w.text));
    const last = (list: typeof original) =>
      RationalTime.toSeconds(list.at(-1)?.range.start ?? RationalTime.zero(MS));
    expect(last(squeezed)).toBeLessThan(last(original));
    expect(last(squeezed) / last(original)).toBeCloseTo(0.966, 2);
  });
});
