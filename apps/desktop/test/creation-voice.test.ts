// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import {
  CancelledError,
  createContainer,
  err,
  FrameRate,
  FrameRates,
  GeneratedAssetSinkToken,
  InterchangeMediaSourceToken,
  newId,
  ok,
  RationalTime,
  unwrap,
  ValidationError,
  VoiceProviderToken,
  type CharacterAlignment,
  type CreationDraft,
  type CreationProject,
  type InterchangeMedia,
  type VoiceProvider,
} from '@taalcut/core';
import { createRepositories } from '@taalcut/library';
import { createCreationVoice, estimateCreationVoice } from '../src/utility/creation/voice';
import {
  alignCreationVoice,
  creationNarration,
  proportionalVoiceTiming,
} from '../src/utility/creation/voice-alignment';
import { creationWorld, draftProject } from './helpers/creation';

function draftOf(...narrations: string[]): CreationDraft {
  return {
    revision: 1,
    title: 'Launch',
    visualDirection: 'One take',
    visualPreviewAssetId: null,
    questions: [],
    beats: narrations.map((narration, index) => ({
      id: `beat-${index}`,
      duration: RationalTime.of(60, FrameRates.fps60),
      narration,
      screenText: '',
      visual: 'A moving word',
      transition: 'Continue',
    })),
  };
}

function alignmentOf(characters: readonly string[]): CharacterAlignment {
  return {
    characters,
    startSeconds: characters.map((_, index) => index / 10),
    endSeconds: characters.map((_, index) => (index + 1) / 10),
  };
}

function connected(project: CreationProject): CreationProject {
  return {
    ...project,
    brief: {
      ...project.brief,
      voice: { mode: 'connected', voiceId: 'recorded', assetId: null, language: 'en' },
    },
  };
}

function recordedProvider(): VoiceProvider {
  return {
    available: () => ({ ok: true }),
    voices: async () => ok([]),
    synthesize: async (request) =>
      ok({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/mpeg',
        sampleRate: 48_000,
        provider: 'recorded',
        model: 'recorded',
        costUsd: 0.1,
        c2pa: 'absent',
        alignment: alignmentOf([...request.text]),
      }),
    createClone: async () => ok({ voiceId: 'recorded', requiresVerification: false }),
    deleteClone: async () => ok(undefined),
  };
}

describe('Create voice alignment', () => {
  it('maps Unicode code points and provider chunks without using text offsets as provider indices', () => {
    const draft = draftOf('Go 🚀', 'नमस्ते é');
    const text = unwrap(creationNarration(draft));
    const points = unwrap(alignCreationVoice(draft, text, alignmentOf([...text])));
    expect(points[1]!.sourceStartMs).toBe(500);
    const units = unwrap(alignCreationVoice(draft, text, alignmentOf(text.split(''))));
    expect(units[1]!.sourceStartMs).toBe(600);
    const chunks = unwrap(alignCreationVoice(draft, text, alignmentOf(['Go 🚀', '\n', 'नमस्ते é'])));
    expect(chunks[1]!.sourceStartMs).toBe(200);
    expect(points[0]!.durationMs).toBe(points[1]!.sourceStartMs);
    expect(alignCreationVoice(draft, text, alignmentOf([text])).ok).toBe(false);
  });

  it('accepts whitespace normalization but rejects changed spoken content', () => {
    const draft = draftOf(' A ', ' B ');
    const text = unwrap(creationNarration(draft));
    const normalized = unwrap(alignCreationVoice(draft, text, alignmentOf([...'  A \r\n B  '])));
    expect(normalized[1]!.sourceStartMs).toBe(700);
    expect(alignCreationVoice(draft, text, alignmentOf([...'A\nC'])).ok).toBe(false);
  });

  it('rejects incomplete, non-finite, reversed and non-monotonic provider timing', () => {
    const draft = draftOf('A', 'B');
    const text = 'A\nB';
    const alignment = alignmentOf([...text]);
    const invalid: CharacterAlignment[] = [
      { ...alignment, characters: ['A', '', 'B'] },
      { ...alignment, startSeconds: [0] },
      { ...alignment, endSeconds: [0.1] },
      { ...alignment, startSeconds: [0, NaN, 0.2] },
      { ...alignment, endSeconds: [0.1, 0.2, Infinity] },
      { ...alignment, startSeconds: [-1, 0.1, 0.2] },
      { ...alignment, endSeconds: [0.1, 0.05, 0.3] },
      { ...alignment, startSeconds: [0.1, 0, 0.2] },
      { ...alignment, endSeconds: [0.15, 0.1, 0.3] },
      { ...alignment, startSeconds: [0, 0, 0] },
    ];
    for (const candidate of invalid) expect(alignCreationVoice(draft, text, candidate).ok).toBe(false);
  });

  it('allocates an uploaded duration once, without cumulative rounding drift', () => {
    const draft = draftOf('A', '', 'C');
    const timing = unwrap(proportionalVoiceTiming(draft, 1001));
    expect(timing.map((line) => line.durationMs)).toEqual([334, 333, 334]);
    expect(timing.map((line) => line.sourceStartMs)).toEqual([0, 334, 667]);
    expect(timing.at(-1)!.sourceStartMs + timing.at(-1)!.durationMs).toBe(1001);
    for (const duration of [0, 2, NaN, Infinity])
      expect(proportionalVoiceTiming(draft, duration).ok).toBe(false);
  });
});

describe('Create voice production', () => {
  it('preflights empty beats and only reserves a connected, valid script', async () => {
    const world = creationWorld();
    const project = connected(await draftProject(world));
    const provider = recordedProvider();
    const synthesize = vi.spyOn(provider, 'synthesize');
    world.container.value(VoiceProviderToken, provider);
    const draft = draftOf('Go 🚀', 'Together');
    expect(estimateCreationVoice(world.container, project, draft)).toBe('Go 🚀\nTogether'.length * 600);
    const empty = draftOf('Go', ' ');
    expect(estimateCreationVoice(world.container, project, empty)).toBe(0);
    const refused = await createCreationVoice(world.container, project, empty, new AbortController().signal);
    expect(refused).toMatchObject({ ok: false, error: { detail: expect.stringContaining('every beat') } });
    expect(synthesize).not.toHaveBeenCalled();
    expect(estimateCreationVoice(world.container, project, draftOf('a'.repeat(5001)))).toBe(0);
    expect(estimateCreationVoice(createContainer(), project, draft)).toBe(0);
    expect(
      estimateCreationVoice(
        world.container,
        {
          ...project,
          brief: { ...project.brief, voice: { ...project.brief.voice, language: 'invalid' } },
        },
        draft,
      ),
    ).toBe(0);
    vi.spyOn(provider, 'available').mockReturnValue({ ok: false, reason: 'not_configured' });
    expect(estimateCreationVoice(world.container, project, draft)).toBe(0);
  });

  it('keeps one provider take with continuous Unicode beat boundaries and its actual charge', async () => {
    const world = creationWorld();
    const project = connected(await draftProject(world));
    const assetId = newId<'Asset'>();
    const provider = recordedProvider();
    const synthesize = vi.spyOn(provider, 'synthesize');
    world.container.value(VoiceProviderToken, provider).value(GeneratedAssetSinkToken, {
      put: async () => ok({ assetId, contentHash: 'a'.repeat(64), duplicate: false }),
    });
    const result = unwrap(
      await createCreationVoice(
        world.container,
        project,
        draftOf('Go 🚀', 'Together'),
        new AbortController().signal,
      ),
    );
    expect(synthesize).toHaveBeenCalledOnce();
    expect(synthesize.mock.calls[0]![0]).toMatchObject({
      text: 'Go 🚀\nTogether',
      quality: 'final',
      seed: 42,
    });
    expect(result.usageMicros).toBe(100_000);
    expect(result.lines.map((line) => line.assetId)).toEqual([assetId, assetId]);
    expect(result.lines[0]!.durationMs).toBe(result.lines[1]!.sourceStartMs);
    expect(result.lines[1]!.sourceStartMs).toBe(500);
  });

  it('preserves provider errors after invocation and never invents a free success', async () => {
    const world = creationWorld();
    const project = connected(await draftProject(world));
    const failure = err(ValidationError({ field: 'provider' }, { detail: 'Provider response was lost' }));
    const provider = recordedProvider();
    const synthesize = vi.spyOn(provider, 'synthesize').mockResolvedValue(failure);
    world.container.value(VoiceProviderToken, provider);
    const result = await createCreationVoice(
      world.container,
      project,
      draftOf('Hello'),
      new AbortController().signal,
    );
    expect(result).toBe(failure);
    expect(synthesize).toHaveBeenCalledOnce();
    const cancelled = await createCreationVoice(
      world.container,
      project,
      draftOf('Hello'),
      AbortSignal.abort(),
    );
    expect(!cancelled.ok && CancelledError.is(cancelled.error)).toBe(true);
    expect(synthesize).toHaveBeenCalledOnce();
  });

  it('reports malformed paid results as failures while retaining valid received audio', async () => {
    const world = creationWorld();
    const project = connected(await draftProject(world));
    const provider = recordedProvider();
    const synthesize = provider.synthesize;
    const put = vi.fn(async () =>
      ok({ assetId: newId<'Asset'>(), contentHash: 'a'.repeat(64), duplicate: false }),
    );
    world.container.value(GeneratedAssetSinkToken, { put }).value(VoiceProviderToken, provider);
    vi.spyOn(provider, 'synthesize').mockImplementation(async (request) => {
      const audio = unwrap(await synthesize(request));
      return ok({ ...audio, alignment: { ...audio.alignment, endSeconds: [Infinity] } });
    });
    const malformed = await createCreationVoice(
      world.container,
      project,
      draftOf('A'),
      new AbortController().signal,
    );
    expect(malformed).toMatchObject({ ok: false, error: { params: { field: 'voice.alignment' } } });
    expect(put).toHaveBeenCalledOnce();
    vi.mocked(provider.synthesize).mockImplementation(async (request) => {
      const audio = unwrap(await synthesize(request));
      return ok({ ...audio, costUsd: -0.0000001 });
    });
    const invalidCost = await createCreationVoice(
      world.container,
      project,
      draftOf('A'),
      new AbortController().signal,
    );
    expect(invalidCost).toMatchObject({ ok: false, error: { params: { field: 'voice.cost' } } });
    expect(put).toHaveBeenCalledOnce();
  });

  it('uses the library audio duration when interchange has no video frame rate', async () => {
    const world = creationWorld();
    const before = await draftProject(world);
    const repos = createRepositories(world.db);
    const asset = unwrap(
      repos.assets.create({
        kind: 'audio',
        sizeBytes: 3,
        originalFilename: 'recording.wav',
        duration: RationalTime.of(48_048, FrameRate.of(48_000, 1)),
      }),
    );
    const project: CreationProject = {
      ...before,
      brief: { ...before.brief, voice: { mode: 'upload', voiceId: null, assetId: asset.id, language: 'en' } },
    };
    const media: InterchangeMedia = {
      path: '/managed/recording.wav',
      lastKnownPath: null,
      name: 'recording.wav',
      rate: null,
      durationFrames: null,
      width: null,
      height: null,
      hasAudio: true,
      audioChannels: 1,
      audioRate: 48_000,
    };
    world.container.value(InterchangeMediaSourceToken, {
      resolve: async () => ok(new Map([[asset.id, media]])),
    });
    const draft = draftOf('A', '', 'C');
    const result = unwrap(
      await createCreationVoice(world.container, project, draft, new AbortController().signal),
    );
    expect(estimateCreationVoice(world.container, project, draft)).toBe(0);
    expect(result.usageMicros).toBe(0);
    expect(result.lines.map((line) => line.durationMs)).toEqual([334, 333, 334]);
    world.container.value(InterchangeMediaSourceToken, {
      resolve: async () => ok(new Map([[asset.id, { ...media, path: null }]])),
    });
    expect(
      (await createCreationVoice(world.container, project, draft, new AbortController().signal)).ok,
    ).toBe(false);
    unwrap(repos.assets.trash([asset.id]));
    expect(
      (await createCreationVoice(world.container, project, draft, new AbortController().signal)).ok,
    ).toBe(false);
  });
});
