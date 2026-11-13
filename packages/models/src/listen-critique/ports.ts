// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: what `audio.cloudCritique` needs from the app. models imports only core, so the source's audio, this
 * Mac's listening and the consent check come in from the composition root (apps/desktop
 * agent-listen-cloud.ts), which reaches media, audio and the agent's run log.
 */
import type {
  ArtifactId,
  ArtifactStore,
  AssetId,
  AsyncResult,
  RunId,
  TimeRange,
  ToolRunId,
} from '@taalcut/core';
import type { ModelClient } from '../client/types';
import type { ModelChoice } from '../modules';
import type { ModelRuntime } from '../runtime/runtime';
import type { ClipWindow, CritiqueFacts } from './context';

/** The source a call names: a library asset (its original) or an artifact from an earlier tool. */
export interface CritiqueSource {
  readonly assetId?: AssetId;
  readonly artifactId?: ArtifactId;
}

/** The audio about to leave this Mac, and the source it came from, until `done`. */
export interface PreparedCritiqueAudio {
  /** A file name or label for results; never a path. */
  readonly name: string;
  /** Mono, CLOUD_CRITIQUE_KBPS, the window only: what the hosted model hears. Never the picture. */
  readonly bytes: Uint8Array;
  /** One Gemini takes inline: 'audio/aac', 'audio/wav', 'audio/mp3', 'audio/flac', 'audio/ogg'. */
  readonly mimeType: string;
  /** The window sent, in file seconds, and how it was encoded ('aac mono 64 kbps'). */
  readonly window: ClipWindow;
  /** The source was longer than the window asked for, so only part of it is sent. */
  readonly trimmed: boolean;
  /** What this Mac hears over the window (measures always; events and sections with `timeline`). */
  facts(options: { readonly timeline: boolean; readonly signal: AbortSignal }): AsyncResult<CritiqueFacts>;
  /** Removes what preparing wrote (the encoded copy). */
  done(): Promise<void>;
}

export interface CritiqueAudio {
  /**
   * Decodes the source's sound and encodes the window (the range, else from the start) as small mono audio, at
   * most `maxSeconds` long. Nothing leaves this Mac here.
   */
  prepare(
    source: CritiqueSource,
    options: {
      readonly range?: TimeRange;
      readonly maxSeconds: number;
      readonly artifacts: ArtifactStore;
      readonly signal: AbortSignal;
    },
  ): AsyncResult<PreparedCritiqueAudio>;
}

/**
 * The person allowed this call's upload: its consent card answered "Allow" (the agent's consent gate, PRD G9), or a
 * standing consent they gave for sound through the module (`vision.audio`; vision's for frames doesn't count). Anything else, a call outside an agent run included, is the app's
 * `audio.cloud_critique_consent_required`. Declared once in @taalcut/audio, so the root hands it back from here.
 */
export interface CritiqueConsent {
  check(call: { readonly callId: ToolRunId; readonly runId?: RunId }): AsyncResult<void>;
}

export interface CloudCritiqueDeps {
  /** Every model call goes through it: the CloudCall log, Local only and cassettes apply. */
  readonly models: ModelClient;
  /** The cloud module's chain now (ModelProfiles.effective): the first Gemini in it is the one used. */
  readonly chain: () => readonly ModelChoice[];
  /** Prices and model facts from the runtime's catalogue, for the estimate. */
  readonly runtime: Pick<ModelRuntime, 'findModel'>;
  /** Settings → Privacy → Local only, read on every call; true until the setting is known. */
  readonly localOnly: () => boolean;
  readonly consent: CritiqueConsent;
  readonly audio: CritiqueAudio;
}
