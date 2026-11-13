// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's `VoiceProvider` on Resemble AI Chatterbox (WP-VO-LOCAL), plus `createCompositeVoiceProvider` to route
 * between cloud (ElevenLabs) and on-device (Chatterbox) synthesis according to the active profile chain and
 * `localOnly` switch.
 */
import { createHash } from 'node:crypto';
import { readFile as readFileFromDisk } from 'node:fs/promises';
import {
  err,
  newId,
  ok,
  ValidationError,
  type AsyncResult,
  type CharacterAlignment,
  type CloudCallSink,
  type GenerationAvailability,
  type Result,
  type SpokenLanguage,
  type SynthesisRequest,
  type SynthesisResult,
  type VoiceConsentId,
  type VoiceProvider,
  type VoiceSummary,
} from '@taalcut/core';
import type { ModelSelector } from '../client/model-client';
import { ModelNotConfigured, NoModelForModule } from '../errors';
import { buildCharacterAlignment, encodeWavPcm16, type AlignedWordTiming } from './alignment';
import {
  CHATTERBOX_BUILTIN_VOICES,
  CHATTERBOX_MODEL_ROLES,
  CHATTERBOX_MODELS,
  CHATTERBOX_PROVIDER,
  CHATTERBOX_SAMPLE_RATE,
  CHATTERBOX_TEXT_LIMIT,
  chatterboxLanguageCode,
  prepareChatterboxText,
} from './spec';

export interface ChatterboxInferInput {
  readonly model: string;
  readonly promptText: string;
  readonly spokenText: string;
  readonly tags: readonly string[];
  readonly voiceId: string;
  readonly referenceAudioBytes?: Uint8Array;
  readonly language: string;
  readonly seed: number;
  readonly signal?: AbortSignal;
}

export interface ChatterboxInferOutput {
  readonly pcm: Float32Array;
  readonly sampleRate?: number;
  readonly alignment?: CharacterAlignment;
  readonly words?: readonly AlignedWordTiming[];
}

export type ChatterboxEngine = (input: ChatterboxInferInput) => AsyncResult<ChatterboxInferOutput>;

export type ChatterboxWordAligner = (input: {
  readonly wavBytes: Uint8Array;
  readonly sampleRate: number;
  readonly text: string;
  readonly language: SpokenLanguage;
  readonly signal?: AbortSignal;
}) => AsyncResult<readonly AlignedWordTiming[]>;

export interface ChatterboxCloneRecord {
  readonly voiceId: string;
  readonly consentId: VoiceConsentId;
  readonly name: string;
  readonly recordingBytes: Uint8Array;
  readonly sha256: string;
}

export interface ChatterboxVoiceDeps {
  readonly engine: ChatterboxEngine;
  readonly selector?: ModelSelector;
  readonly aligner?: ChatterboxWordAligner;
  readonly callLog?: CloudCallSink;
  /** Whether the local Chatterbox ONNX/MLX component is installed on disk; default `() => true`. */
  readonly isInstalled?: (model: string) => boolean;
  readonly readFile?: (path: string) => Promise<Uint8Array>;
  readonly now?: () => number;
}

const MAX_SEED = 4_294_967_295;
const readDisk = async (path: string) => new Uint8Array(await readFileFromDisk(path));

function chatterboxChain(selector: ModelSelector | undefined): Result<readonly string[] | null> {
  if (!selector) return ok(null);
  const chain = selector.resolve('voice');
  if (!chain.ok) return chain;
  return ok(
    chain.value.choices
      .filter((choice) => choice.provider === CHATTERBOX_PROVIDER)
      .map((choice) => choice.model),
  );
}

function selectChatterboxModel(
  quality: 'draft' | 'final',
  language: string,
  chain: readonly string[] | null,
): Result<string> {
  const lang = chatterboxLanguageCode(language);
  if (chain === null) {
    if (lang !== 'en') return ok(CHATTERBOX_MODELS.final);
    return ok(CHATTERBOX_MODELS[quality]);
  }
  if (chain.length === 0) return err(NoModelForModule({ module: 'voice' }));
  if (lang !== 'en' && chain.includes(CHATTERBOX_MODELS.final)) {
    return ok(CHATTERBOX_MODELS.final);
  }
  const role = (model: string) => CHATTERBOX_MODEL_ROLES[model] ?? 'both';
  const fitting = chain.find((model) => role(model) === quality || role(model) === 'both');
  return ok(fitting ?? chain[0]!);
}

function validateLine(request: SynthesisRequest): Result<void> {
  const text = request.text.trim();
  if (text.length === 0 || request.text.length > CHATTERBOX_TEXT_LIMIT) {
    return err(ValidationError({ field: 'text' }, { detail: 'A line has 1 to 5,000 characters.' }));
  }
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > MAX_SEED) {
    return err(ValidationError({ field: 'seed' }));
  }
  return ok(undefined);
}

export function createChatterboxVoice(deps: ChatterboxVoiceDeps): VoiceProvider {
  const readFile = deps.readFile ?? readDisk;
  const isInstalled = deps.isInstalled ?? (() => true);
  const now = deps.now ?? Date.now;
  const clones = new Map<string, ChatterboxCloneRecord>();

  return {
    available(): GenerationAvailability {
      const chain = chatterboxChain(deps.selector);
      if (!chain.ok) return { ok: false, reason: 'no_model' };
      const models =
        chain.value === null ? [CHATTERBOX_MODELS.draft, CHATTERBOX_MODELS.final] : chain.value;
      if (models.length === 0) return { ok: false, reason: 'no_model' };
      if (!models.some((model) => isInstalled(model))) {
        return { ok: false, reason: 'not_configured' };
      }
      return { ok: true };
    },

    async synthesize(request: SynthesisRequest): AsyncResult<SynthesisResult> {
      const started = now();
      const valid = validateLine(request);
      if (!valid.ok) return valid;
      const chain = chatterboxChain(deps.selector);
      if (!chain.ok) return chain;
      const chosen = selectChatterboxModel(request.quality, request.language, chain.value);
      if (!chosen.ok) return chosen;
      const model = chosen.value;
      if (!isInstalled(model)) {
        return err(ModelNotConfigured({ provider: CHATTERBOX_PROVIDER, model }));
      }
      const prepared = prepareChatterboxText(request.text, model);
      const clone = clones.get(request.voiceId);
      const generated = await deps.engine({
        model,
        promptText: prepared.promptText,
        spokenText: prepared.spokenText,
        tags: prepared.tags,
        voiceId: request.voiceId,
        ...(clone ? { referenceAudioBytes: clone.recordingBytes } : {}),
        language: chatterboxLanguageCode(request.language),
        seed: request.seed,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!generated.ok) return generated;
      const sampleRate = generated.value.sampleRate ?? CHATTERBOX_SAMPLE_RATE;
      const bytes = encodeWavPcm16(generated.value.pcm, sampleRate);
      const durationSeconds = generated.value.pcm.length / Math.max(1, sampleRate);

      let alignment = generated.value.alignment;
      if (!alignment) {
        let words = generated.value.words;
        if (!words && deps.aligner) {
          const aligned = await deps.aligner({
            wavBytes: bytes,
            sampleRate,
            text: prepared.spokenText,
            language: request.language,
            ...(request.signal ? { signal: request.signal } : {}),
          });
          if (aligned.ok) words = aligned.value;
        }
        alignment = buildCharacterAlignment(prepared.spokenText, durationSeconds, words);
      }

      if (deps.callLog) {
        await deps.callLog.record({
          id: newId<'CloudCall'>(),
          startedAt: started,
          latencyMs: Math.max(0, now() - started),
          provider: CHATTERBOX_PROVIDER,
          model,
          module: 'voice',
          reasoning: 'off',
          local: true,
          bytesSent: Buffer.byteLength(request.text, 'utf8'),
          bytesReceived: bytes.byteLength,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          billed: { unit: 'character', quantity: request.text.length },
          costUsd: 0,
          attempt: 1,
          outcome: 'ok',
          ...(request.trace?.runId ? { runId: request.trace.runId } : {}),
          ...(request.trace?.spanId ? { spanId: request.trace.spanId } : {}),
          ...(request.trace?.projectId ? { projectId: request.trace.projectId } : {}),
        });
      }

      return ok({
        bytes,
        mediaType: 'audio/wav',
        sampleRate,
        alignment,
        provider: CHATTERBOX_PROVIDER,
        model,
        costUsd: 0,
        c2pa: 'absent',
      });
    },

    async voices(filter = {}): AsyncResult<VoiceSummary[]> {
      const targetLang = filter.language ? chatterboxLanguageCode(filter.language) : undefined;
      const builtins = CHATTERBOX_BUILTIN_VOICES.filter((voice) => {
        if (!targetLang) return true;
        const voiceLang = voice.labels.language
          ? chatterboxLanguageCode(voice.labels.language)
          : undefined;
        return !voiceLang || voiceLang === targetLang;
      });
      const ownVoices: VoiceSummary[] = [...clones.values()].map((record) => ({
        voiceId: record.voiceId,
        name: record.name,
        labels: { source: 'consent_recording' },
        own: true,
      }));
      return ok([...builtins, ...ownVoices]);
    },

    async createClone(request): AsyncResult<{ readonly voiceId: string; readonly requiresVerification: boolean }> {
      const name = request.name.trim();
      if (!name) return err(ValidationError({ field: 'name' }));
      let recordingBytes: Uint8Array;
      try {
        recordingBytes = await readFile(request.recordingPath);
      } catch (cause) {
        return err(ValidationError({ field: 'recordingPath' }, { detail: String(cause) }));
      }
      if (recordingBytes.byteLength === 0) {
        return err(ValidationError({ field: 'recordingPath' }, { detail: 'Empty consent recording.' }));
      }
      const sha256 = createHash('sha256').update(recordingBytes).digest('hex');
      const voiceId = `cb_clone_${sha256.slice(0, 16)}`;
      clones.set(voiceId, {
        voiceId,
        consentId: request.consentId,
        name,
        recordingBytes,
        sha256,
      });
      return ok({ voiceId, requiresVerification: false });
    },

    async deleteClone(voiceId: string): AsyncResult<void> {
      clones.delete(voiceId);
      return ok(undefined);
    },
  };
}

export interface CompositeVoiceProviderDeps {
  readonly cloud: VoiceProvider;
  readonly local: VoiceProvider;
  readonly selector?: ModelSelector;
  readonly localOnly?: () => boolean;
}

/**
 * Routes `VoiceProvider` calls between `cloud` (ElevenLabs) and `local` (Chatterbox): uses `local` whenever
 * `localOnly()` is on, when the active profile's primary voice model is `resemble/*`, or when `cloud` is
 * unavailable (`local_only` / `not_configured`) and `local` is ready.
 */
export function createCompositeVoiceProvider(deps: CompositeVoiceProviderDeps): VoiceProvider {
  const prefersLocal = (): boolean => {
    if (deps.localOnly?.()) return true;
    const resolved = deps.selector?.resolve('voice');
    if (resolved?.ok && resolved.value.choices[0]?.provider === CHATTERBOX_PROVIDER) return true;
    const cloudAvail = deps.cloud.available();
    if (!cloudAvail.ok && deps.local.available().ok) return true;
    return false;
  };

  return {
    available(): GenerationAvailability {
      if (prefersLocal()) return deps.local.available();
      const cloud = deps.cloud.available();
      return cloud.ok ? cloud : deps.local.available().ok ? { ok: true } : cloud;
    },
    synthesize(request) {
      return prefersLocal() ? deps.local.synthesize(request) : deps.cloud.synthesize(request);
    },
    voices(filter) {
      return prefersLocal() ? deps.local.voices(filter) : deps.cloud.voices(filter);
    },
    createClone(request) {
      return prefersLocal() ? deps.local.createClone(request) : deps.cloud.createClone(request);
    },
    deleteClone(voiceId, signal) {
      return prefersLocal()
        ? deps.local.deleteClone(voiceId, signal)
        : deps.cloud.deleteClone(voiceId, signal);
    },
  };
}
