// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's media and AI contract (round P3-1): voice consent and voiceover commands, the mix commands, asset
 * provenance, stock media, speech cleanup, the voice capture service and the agent's settings.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_SETTING_COMMANDS,
  agentSettingCommandPayloads,
  ANALYZE_SPEECH_JOB_KIND,
  analyzeSpeechJobInputSchema,
  assetProvenanceSchema,
  CAPTURED,
  creditsSchema,
  DEFAULT_DUCKING,
  DuckingPlannerToken,
  GENERATED_MEDIA_TYPES,
  GeneratedAssetSinkToken,
  implementContract,
  MIX_COMMANDS,
  mixCommandPayloads,
  newId,
  ROUTER_SETTING,
  SOUL_DIALS_SETTING,
  SpeechCleanupSourceToken,
  speechCleanupAnalysisSchema,
  stockItemRefSchema,
  stockResultSchema,
  stockSearchInputSchema,
  stockSearchPageSchema,
  TextTranslatorToken,
  TRANSLATION_LIMITS,
  VOICE_CAPTURE_TTL_MS,
  VOICE_COMMANDS,
  VOICE_CONSENT_COMMANDS,
  VOICE_CONSENT_PHRASE_MATCH,
  VOICE_CONSENT_TERMS_VERSION,
  voiceCaptureContract,
  voiceCaptureFilesContract,
  voiceCommandPayloads,
  voiceConsentCommandPayloads,
  voiceConsentSchema,
  VoiceConsentStoreToken,
} from '@taalcut/core';
import { at, SHA, T0 } from './helpers/documents';
import { serve } from './helpers/phase3';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const consentId = newId<'VoiceConsent'>();
const range = (start: number, duration: number) => ({ start: at(start), duration: at(duration) });

describe('voice consent and voiceover', () => {
  it('records a consent only from a capture key, app-wide', () => {
    const record = voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.recordConsent];
    const payload = {
      consentId,
      captureKey: newId<'VoiceCapture'>(),
      speakerName: '  Mira  ',
      language: 'en',
      termsVersion: VOICE_CONSENT_TERMS_VERSION,
    };
    expect(record.parse(payload)).toMatchObject({ projectId: null, speakerName: 'Mira' });
    expect(record.safeParse({ ...payload, captureKey: '/Users/me/voice.wav' }).success).toBe(false);
    expect(record.safeParse({ ...payload, projectId }).success).toBe(false);
    const clone = voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.createClone];
    expect(clone.safeParse({ consentId, name: '' }).success).toBe(false);
    expect(voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.withdrawConsent].parse({ consentId })).toEqual({
      consentId,
      projectId: null,
    });
    expect(voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.deleteClone].safeParse({}).success).toBe(false);
  });

  it('stores a consent with its recording hash and match, a minute or more long', () => {
    const consent = {
      id: consentId,
      speakerName: 'Mira',
      language: 'pt-BR',
      termsVersion: '1',
      recordingSha256: SHA,
      recordingDurationMs: 61_000,
      phraseMatch: VOICE_CONSENT_PHRASE_MATCH,
      recordedAt: T0,
      clone: { provider: 'elevenlabs', voiceId: 'v1', createdAt: T0 },
    };
    expect(voiceConsentSchema.parse(consent)).toEqual(consent);
    expect(voiceConsentSchema.safeParse({ ...consent, recordingDurationMs: 30_000 }).success).toBe(false);
    expect(voiceConsentSchema.safeParse({ ...consent, phraseMatch: 1.2 }).success).toBe(false);
    expect(VoiceConsentStoreToken.key).toBe('core.voiceConsentStore');
  });

  it('applies a voiceover with its voice track and removes it by target', () => {
    const lineId = newId<'VoiceLine'>();
    const apply = voiceCommandPayloads[VOICE_COMMANDS.applyVoiceover].parse({
      projectId,
      timelineId,
      revision: 3,
      voiceover: {
        id: newId<'Voiceover'>(),
        voiceId: 'v1',
        voiceName: 'Ana',
        own: false,
        language: 'pt-BR',
        seed: 7,
        lines: [
          {
            id: lineId,
            text: 'Primeiro, o café.',
            slotId: null,
            clipId: null,
            assetId: null,
            quality: 'draft',
            duration: at(42),
            offBeat: false,
          },
        ],
      },
      track: { id: 'A2', name: 'Voice', enabled: true, kind: 'audio', role: 'voice', items: [] },
    });
    expect(apply.voiceover.lines[0]?.id).toBe(lineId);
    const remove = voiceCommandPayloads[VOICE_COMMANDS.removeVoiceover];
    expect(remove.safeParse({ projectId, timelineId, revision: 0 }).success).toBe(false);
  });
});

describe('mix commands', () => {
  it('changes ducking by a non-empty patch and replaces the effect hits', () => {
    const ducking = mixCommandPayloads[MIX_COMMANDS.setDucking];
    expect(ducking.parse({ projectId, timelineId, ducking: { marginLu: 9 } }).ducking).toEqual({
      marginLu: 9,
    });
    expect(ducking.safeParse({ projectId, timelineId, ducking: {} }).success).toBe(false);
    expect(ducking.safeParse({ projectId, timelineId, ducking: { marginLu: 3 } }).success).toBe(false);
    expect(DEFAULT_DUCKING.enabled).toBe(true);
    const hits = mixCommandPayloads[MIX_COMMANDS.setHits];
    const hit = {
      id: newId<'TimelineItem'>(),
      at: at(30),
      assetId: newId<'Asset'>(),
      sourceStart: at(0),
      duration: at(10),
      gainDb: -12,
      category: 'whoosh',
    };
    expect(hits.parse({ projectId, timelineId, hits: [hit] }).hits).toHaveLength(1);
    expect(hits.safeParse({ projectId, timelineId, hits: [{ ...hit, gainDb: 3 }] }).success).toBe(false);
  });
});

describe('asset provenance and generated media', () => {
  const generated = {
    kind: 'generated',
    generation: 'voice',
    provider: 'elevenlabs',
    model: 'eleven_v3',
    access: 'api-key',
    quality: 'final',
    promptSha256: SHA,
    voiceId: 'v1',
    providerRef: null,
    c2pa: 'present',
    costUsd: 0.04,
    runId: null,
    createdAt: T0,
  } as const;

  it('tells captured, generated, bundled and stock assets apart', () => {
    expect(assetProvenanceSchema.parse(CAPTURED)).toEqual({ kind: 'captured' });
    expect(assetProvenanceSchema.parse(generated)).toEqual(generated);
    const bundled = {
      kind: 'bundled',
      pack: 'music-pack',
      itemId: 'sunny-01',
      licence: 'CC0-1.0',
      sourceUrl: 'https://example.org/sunny',
      title: 'Sunny',
    };
    expect(assetProvenanceSchema.parse(bundled)).toEqual(bundled);
    expect(assetProvenanceSchema.safeParse({ ...bundled, licence: 'CC-BY-4.0' }).success).toBe(false);
    const stock = {
      kind: 'stock',
      provider: 'pexels',
      providerAssetId: '123',
      licence: 'Pexels-Licence',
      rawLicence: 'Pexels License',
      author: 'Ana',
      authorUrl: 'https://www.pexels.com/@ana',
      sourceUrl: 'https://www.pexels.com/video/123',
      attribution: '',
      fetchedAt: T0,
    };
    expect(assetProvenanceSchema.parse(stock)).toEqual(stock);
    expect(assetProvenanceSchema.safeParse({ ...generated, c2pa: 'maybe' }).success).toBe(false);
  });

  it('names its ports by token', () => {
    expect(GeneratedAssetSinkToken.key).toBe('core.generatedAssetSink');
    expect(GENERATED_MEDIA_TYPES).toContain('audio/wav');
    expect(DuckingPlannerToken.key).toBe('core.duckingPlanner');
    expect(TextTranslatorToken.key).toBe('core.textTranslator');
    expect(TRANSLATION_LIMITS.units).toBe(100);
  });
});

describe('stock media', () => {
  const result = {
    provider: 'pexels',
    providerId: '123',
    kind: 'video',
    title: 'Coffee pour',
    author: { name: 'Ana', url: null },
    pageUrl: 'https://www.pexels.com/video/123',
    licence: 'Pexels-Licence',
    seconds: 8,
    width: 1080,
    height: 1920,
    fps: 30,
    preview: `app://media/stock/${SHA}.jpg`,
    renditionKey: 'hd-portrait',
    alreadyImported: null,
  } as const;

  it('shows results with previews only from the stock cache', () => {
    expect(stockSearchPageSchema.parse({ items: [result], providersOff: ['freesound'] }).items).toHaveLength(
      1,
    );
    expect(
      stockResultSchema.safeParse({ ...result, preview: 'https://images.pexels.com/1.jpg' }).success,
    ).toBe(false);
    expect(stockItemRefSchema.parse(result)).toEqual({
      provider: 'pexels',
      providerId: '123',
      kind: 'video',
      renditionKey: 'hd-portrait',
    });
    expect(
      creditsSchema.parse({ required: ['Music by Ana (CC BY 4.0)'], courtesy: [] }).required,
    ).toHaveLength(1);
  });

  it('searches with a length range that makes sense, page 1 by default', () => {
    expect(stockSearchInputSchema.parse({ query: ' coffee ', kind: 'video' })).toEqual({
      query: 'coffee',
      kind: 'video',
      page: 1,
    });
    const ranged = { query: 'coffee', kind: 'video', minSeconds: 3, maxSeconds: 10 };
    expect(stockSearchInputSchema.safeParse(ranged).success).toBe(true);
    expect(stockSearchInputSchema.safeParse({ ...ranged, minSeconds: 12 }).success).toBe(false);
    expect(stockSearchInputSchema.safeParse({ query: '', kind: 'video' }).success).toBe(false);
  });
});

describe('speech cleanup analysis', () => {
  it('keeps words, fillers, pauses, retakes and emphasis in source time', () => {
    const analysis = {
      version: 1,
      assetId: newId<'Asset'>(),
      contentHash: 'abc',
      configVersion: 1,
      language: 'en',
      engine: 'parakeet',
      words: [{ text: 'So', range: range(0, 10), confidence: 0.9 }],
      speech: [range(0, 60)],
      fillers: [{ range: range(10, 8), text: 'um', wordIndex: null, confidence: 0.8 }],
      pauses: [{ range: range(18, 12) }],
      retakes: [{ earlier: range(0, 20), later: range(30, 20), similarity: 0.92, kind: 'repeat' }],
      emphasis: [{ wordIndex: 0, range: range(0, 10), strength: 0.7 }],
      ambiguous: [],
    };
    expect(speechCleanupAnalysisSchema.parse(analysis)).toEqual(analysis);
    expect(speechCleanupAnalysisSchema.safeParse({ ...analysis, version: 2 }).success).toBe(false);
    expect(SpeechCleanupSourceToken.key).toBe('core.speechCleanupSource');
    expect(ANALYZE_SPEECH_JOB_KIND).toBe('audio.analyzeSpeech');
    expect(analyzeSpeechJobInputSchema.safeParse({ assetId: 'x' }).success).toBe(false);
  });
});

describe('voice capture', () => {
  it('records in chunks and hands the agent a key, never a path from the window', async () => {
    const captureId = newId<'VoiceCapture'>();
    const appended: number[] = [];
    const os = implementContract(voiceCaptureContract);
    const client = serve(
      voiceCaptureContract,
      os.router({
        permission: os.permission.handler(() => 'granted' as const),
        start: os.start.handler(() => ({ captureId })),
        append: os.append.handler(({ input }) => {
          appended.push(input.seq);
        }),
        stop: os.stop.handler(() => ({ captureKey: captureId, durationMs: 61_000, sha256: SHA })),
        cancel: os.cancel.handler(() => undefined),
      }),
    );
    expect(await client.permission()).toBe('granted');
    expect(await client.start({ consentId, sampleRate: 48_000 })).toEqual({ captureId });
    await client.append({ captureId, seq: 0, pcmBase64: 'AAAA' });
    await expect(client.append({ captureId, seq: 1, pcmBase64: 'not base64!' })).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
    await expect(client.start({ consentId, sampleRate: 44_100 as 48_000 })).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
    expect((await client.stop({ captureId })).captureKey).toBe(captureId);
    await client.cancel({ captureId });
    expect(appended).toEqual([0]);
    expect(VOICE_CAPTURE_TTL_MS).toBe(3_600_000);

    const files = implementContract(voiceCaptureFilesContract);
    const claim = serve(
      voiceCaptureFilesContract,
      files.router({ claim: files.claim.handler(() => ({ path: '/app/captures/x.wav' })) }),
    );
    expect(await claim.claim({ captureKey: captureId })).toEqual({ path: '/app/captures/x.wav' });
  });
});

describe('agent settings', () => {
  it('defaults the dials and keeps the router off', () => {
    expect(SOUL_DIALS_SETTING.defaultValue).toEqual({ tone: 2, verbosity: 1 });
    expect(ROUTER_SETTING.defaultValue).toMatchObject({ mode: 'off', gate: null });
  });

  it('changes dials or the router by a non-empty patch, app-wide', () => {
    const dials = agentSettingCommandPayloads[AGENT_SETTING_COMMANDS.setSoulDials];
    expect(dials.parse({ tone: 4 })).toEqual({ tone: 4, projectId: null });
    expect(dials.safeParse({}).success).toBe(false);
    expect(dials.safeParse({ verbosity: 5 }).success).toBe(false);
    const router = agentSettingCommandPayloads[AGENT_SETTING_COMMANDS.setRouter];
    expect(router.parse({ families: { library: 'live' } })).toMatchObject({ families: { library: 'live' } });
    expect(router.safeParse({}).success).toBe(false);
    expect(router.safeParse({ families: { 'Bad Family': 'live' } }).success).toBe(false);
  });
});
