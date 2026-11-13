// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's Phase 3 wiring in the agent process (agent-audio*.ts): the providers and the speech cleanup source are
 * registered, the voice and mix commands are on the bus, the cleanup and translation tools are offered, and the
 * generation tools and the Voice director join because the library keeps generated files (its GeneratedAssetSink,
 * registered by library-phase3.ts); without a sink paid generation stays unavailable. Local synthesis uses run
 * artifacts instead. The Voice director reads the lines'
 * transcripts from the library for its coverage check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandBusToken,
  createContainer,
  err,
  EventBusToken,
  FrameRate,
  GeneratedAssetSinkToken,
  JobRunnerToken,
  MusicProviderToken,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  SfxProviderToken,
  SpeechCleanupSourceToken,
  TextTranslatorToken,
  TimelineStoreToken,
  TimeRange,
  unwrap,
  VoiceProviderToken,
  type Container,
  type GeneratedAssetSink,
  type ToolContextBase,
} from '@taalcut/core';
import { createToolRegistry } from '@taalcut/tools';
import { createRepositories, openDatabase } from '@taalcut/library';
import { SkillModulesToken } from '@taalcut/agent';
import { LibraryDatabaseToken, ToolRegistryToken } from '../src/shared/tokens';
import { withAudioTools } from '../src/utility/roots/agent-audio';
import { canGenerate } from '../src/utility/roots/agent-audio-services';
import { generationPrices } from '../src/utility/roots/agent-audio-prices';
import { audioAgentSkills, voiceSkillDeps } from '../src/utility/roots/agent-audio-skills';
import { testAgent, testConfig } from './helpers/roots';

const sink: GeneratedAssetSink = {
  put: async () => ok({ assetId: newId<'Asset'>(), contentHash: 'a'.repeat(64), duplicate: false }),
};

const open: Container[] = [];
afterEach(async () => {
  for (const container of open.splice(0)) await container.dispose();
});

function agent(): Container {
  const { container } = testAgent(testConfig('agent'));
  open.push(container);
  return container;
}

const toolNames = (container: Container) =>
  container
    .resolve(ToolRegistryToken)
    .catalogue()
    .map((tool) => tool.name);

describe('audio in the agent process', () => {
  it('registers the providers, the translator, the cleanup source and the voice and mix commands', () => {
    const container = agent();
    for (const token of [
      VoiceProviderToken,
      MusicProviderToken,
      SfxProviderToken,
      TextTranslatorToken,
      SpeechCleanupSourceToken,
    ])
      expect(container.has(token), token.key).toBe(true);
    // Nothing leaves before Local only has been read (agent-flows.ts' flag).
    expect(container.resolve(VoiceProviderToken).available()).toEqual({ ok: false, reason: 'local_only' });
    const commands = container
      .resolve(CommandBusToken)
      .list()
      .map((command) => command.name);
    expect(commands).toEqual(
      expect.arrayContaining([
        'voice.applyVoiceover',
        'voice.removeVoiceover',
        'music.setDucking',
        'sfx.setHits',
      ]),
    );
  });

  it('offers the cleanup tool, and generation because the library keeps generated files', () => {
    const container = agent();
    expect(container.has(GeneratedAssetSinkToken)).toBe(true);
    expect(toolNames(container)).toEqual(
      expect.arrayContaining([
        'audio.analyzeCleanup',
        'audio.recommendDspChain',
        'audio.snapToGroove',
        'voice.fitScript',
        'voice.generate',
        'voice.finalize',
        'music.generate',
        'music.setDucking',
        'music.findLibraryTrack',
        'music.useLibraryTrack',
        'sfx.addHits',
        'sfx.generateHit',
        'sfx.synthesizeProcedural',
      ]),
    );
    expect(withAudioTools(container, []).map((module) => module.id)).toEqual([
      'captions',
      'audio',
      'voice',
      'music',
      'sfx',
    ]);
  });

  it('keeps paid generation unavailable where no sink keeps the files', () => {
    const root = agent();
    const bare = createContainer()
      .value(VoiceProviderToken, root.resolve(VoiceProviderToken))
      .value(MusicProviderToken, root.resolve(MusicProviderToken))
      .value(SfxProviderToken, root.resolve(SfxProviderToken));
    open.push(bare);
    expect(canGenerate(bare)).toBe(false);
    bare.value(GeneratedAssetSinkToken, sink);
    expect(canGenerate(bare)).toBe(true);
  });

  it('synthesizes a local WAV through the registry without paid providers or a library sink', async () => {
    const root = agent();
    const events = root.resolve(EventBusToken);
    const fallback = vi.fn();
    const unsubscribe = events.on('compute.fallback', ({ payload }) => fallback(payload));
    const bare = createContainer()
      .value(TimelineStoreToken, root.resolve(TimelineStoreToken))
      .value(JobRunnerToken, root.resolve(JobRunnerToken))
      .value(EventBusToken, events);
    open.push(bare);
    expect(canGenerate(bare)).toBe(false);
    const registry = unwrap(createToolRegistry(withAudioTools(bare, [])));
    expect(registry.describe('sfx.generateHit')).toBeUndefined();
    const synthesis = registry.resolve('sfx.synthesizeProcedural')!.spec;
    const artifacts: Parameters<ToolContextBase['artifacts']['put']>[0][] = [];
    const context: ToolContextBase = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      attempt: 1,
      artifacts: {
        put: async (artifact) => {
          artifacts.push(artifact);
          return ok({
            id: newId<'Artifact'>(),
            mediaType: artifact.mediaType,
            bytes: typeof artifact.data === 'string' ? artifact.data.length : artifact.data.byteLength,
            summary: artifact.summary,
          });
        },
        get: async () => err(NotFoundError({ entity: 'artifact' })),
      },
      reportUsage: () => undefined,
      reportProgress: () => undefined,
    };
    const result = await synthesis.run(
      synthesis.input.parse({ category: 'ui-click', durationMs: 100 }),
      context,
    );
    expect(result.ok).toBe(true);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.mediaType).toBe('audio/wav');
    expect(new TextDecoder().decode((artifacts[0]?.data as Uint8Array).slice(0, 4))).toBe('RIFF');
    expect(fallback).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'audio.synthesizeProceduralSfx',
        reason: 'no_accelerator',
        wanted: ['metal', 'webgpu', 'cuda'],
      }),
    );
    unsubscribe();
  });

  it('declares the Voice director with the generation tools', () => {
    const container = agent();
    expect(container.resolve(SkillModulesToken).map((module) => module.id)).toContain('voice');
    expect(audioAgentSkills(container).map((module) => module.id)).toEqual(['voice']);
  });

  it("gives the Voice director the library's stored transcripts for its coverage check", async () => {
    const db = unwrap(openDatabase({ path: ':memory:' }));
    try {
      const repos = createRepositories(db);
      const asset = unwrap(
        repos.assets.create({ kind: 'audio', sizeBytes: 10, originalFilename: 'voice.mp3' }),
      );
      const ms = FrameRate.of(1000, 1);
      const range = TimeRange.of(RationalTime.of(0, ms), RationalTime.of(400, ms));
      const words = [{ text: 'Follow', range, confidence: 1 }];
      unwrap(
        repos.transcripts.put(
          asset.id,
          {
            version: 1,
            language: 'en',
            segments: [{ text: 'Follow', range, language: 'en', words }],
            engine: 'tts',
            model: 'eleven_v4',
            local: false,
            wordTiming: 'native',
          },
          0,
        ),
      );
      const container = agent();
      const bare = createContainer().value(TimelineStoreToken, container.resolve(TimelineStoreToken));
      open.push(bare);
      expect(voiceSkillDeps(bare).transcripts).toBeUndefined();
      bare.value(LibraryDatabaseToken, db);
      const transcripts = voiceSkillDeps(bare).transcripts;
      expect(unwrap((await transcripts?.transcript(asset.id)) ?? ok(null))?.segments[0]?.text).toBe('Follow');
      expect(unwrap((await transcripts?.transcript(newId<'Asset'>())) ?? ok(null))).toBeNull();
    } finally {
      db.close();
    }
  });

  it('folds captions.translate into the captions module, in its own routing family', () => {
    const registry = agent().resolve(ToolRegistryToken);
    expect(registry.describe('captions.translate')?.family).toBe('translation');
    const editorFamily = registry.catalogue({ families: ['captions'] }).map((tool) => tool.name);
    expect(editorFamily.length).toBeGreaterThan(0);
    expect(editorFamily).not.toContain('captions.translate');
  });

  it("estimates from models' ElevenLabs list prices", () => {
    expect(generationPrices.voicePerCharacter('final')).toBeCloseTo(0.08 / 1000, 12);
    expect(generationPrices.voicePerCharacter('draft')).toBeCloseTo(0.04 / 1000, 12);
    expect(generationPrices.musicPerSecond()).toBeCloseTo(0.15 / 60, 12);
    expect(generationPrices.sfxPerSecond()).toBeCloseTo(0.12 / 60, 12);
  });
});
