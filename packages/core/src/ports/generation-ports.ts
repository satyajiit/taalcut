// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Voice, music and sound-effect generation (P3-B6, P3-V6): ports @taalcut/models implements and @taalcut/audio
 * calls, both in the agent process. Each says whether it can run now (Local only, no key, no model, a plan the
 * provider requires) before anything is sent. Results carry the provider's bytes untouched, what they cost and
 * whether the provider signed them (C2PA).
 */
import type { SpokenLanguage } from '../analysis/transcript';
import type { ProjectId, VoiceConsentId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { C2paPresence } from '../render/content-credentials';

export interface GenerationTrace {
  readonly runId?: string;
  readonly spanId?: string;
  readonly projectId?: ProjectId;
}

export const GENERATION_UNAVAILABLE_REASONS = [
  'local_only',
  'not_configured',
  'no_model',
  'plan_required',
] as const;
export type GenerationAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: (typeof GENERATION_UNAVAILABLE_REASONS)[number] };

export type GeneratedAudioType = 'audio/mpeg' | 'audio/wav';

/** Character timings as the provider returns them: audio groups them into words. */
export interface CharacterAlignment {
  readonly characters: readonly string[];
  readonly startSeconds: readonly number[];
  readonly endSeconds: readonly number[];
}

export interface SynthesisRequest {
  /** At most 5,000 characters: one script line. */
  readonly text: string;
  readonly voiceId: string;
  readonly language: SpokenLanguage;
  /** draft: the module chain's fast model; final: its flagship. */
  readonly quality: 'draft' | 'final';
  readonly seed: number;
  readonly previousText?: string;
  readonly nextText?: string;
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface SynthesisResult {
  readonly bytes: Uint8Array;
  readonly mediaType: GeneratedAudioType;
  readonly sampleRate: number;
  readonly alignment: CharacterAlignment;
  readonly provider: string;
  readonly model: string;
  readonly costUsd: number;
  readonly c2pa: C2paPresence;
}

export interface VoiceSummary {
  readonly voiceId: string;
  /** Provider text: untrusted. */
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  /** A clone made from this user's consent recording. */
  readonly own: boolean;
}

export interface VoiceProvider {
  available(): GenerationAvailability;
  synthesize(request: SynthesisRequest): AsyncResult<SynthesisResult>;
  voices(filter?: {
    readonly language?: SpokenLanguage;
    readonly signal?: AbortSignal;
  }): AsyncResult<VoiceSummary[]>;
  /** Only with a consent the caller checked; uploads the in-app recording and nothing else. */
  createClone(request: {
    readonly consentId: VoiceConsentId;
    readonly recordingPath: string;
    readonly name: string;
    readonly signal?: AbortSignal;
  }): AsyncResult<{ readonly voiceId: string; readonly requiresVerification: boolean }>;
  /** Idempotent: an unknown voice is success. */
  deleteClone(voiceId: string, signal?: AbortSignal): AsyncResult<void>;
}

export interface CompositionChunk {
  /** At most 200 characters. */
  readonly text: string;
  /** 3,000 to 120,000. */
  readonly durationMs: number;
  readonly positiveStyles: readonly string[];
  readonly negativeStyles: readonly string[];
}

export interface MusicRequest {
  readonly plan:
    | { readonly kind: 'chunks'; readonly chunks: readonly CompositionChunk[] }
    | {
        readonly kind: 'prompt';
        readonly prompt: string;
        readonly lengthMs: number;
        readonly instrumental: boolean;
      };
  readonly seed?: number;
  /** Ask the provider to sign the file (C2PA; MP3 only). */
  readonly signWithC2pa: boolean;
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface MusicResult {
  readonly bytes: Uint8Array;
  readonly mediaType: GeneratedAudioType;
  readonly provider: string;
  readonly model: string;
  /** The provider's id for the song; null when it gave none. */
  readonly songId: string | null;
  readonly costUsd: number;
  /** The price is an estimate (the provider publishes no fixed rate). */
  readonly estimated: boolean;
  readonly c2pa: C2paPresence;
}

export interface MusicProvider {
  available(): GenerationAvailability;
  compose(request: MusicRequest): AsyncResult<MusicResult>;
}

export interface SfxRequest {
  /** At most 500 characters. */
  readonly text: string;
  /** 0.5 to 30. */
  readonly durationSeconds: number;
  readonly loop: boolean;
  /** 0 to 1; the provider's default is 0.3. */
  readonly promptInfluence: number;
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface SfxResult {
  readonly bytes: Uint8Array;
  readonly mediaType: GeneratedAudioType;
  readonly provider: string;
  readonly model: string;
  readonly costUsd: number;
  readonly c2pa: C2paPresence;
}

export interface SfxProvider {
  available(): GenerationAvailability;
  generate(request: SfxRequest): AsyncResult<SfxResult>;
}

export const VoiceProviderToken = createToken<VoiceProvider>('core.voiceProvider');
export const MusicProviderToken = createToken<MusicProvider>('core.musicProvider');
export const SfxProviderToken = createToken<SfxProvider>('core.sfxProvider');
