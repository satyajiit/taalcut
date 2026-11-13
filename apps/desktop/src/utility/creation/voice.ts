// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  CancelledError,
  err,
  GeneratedAssetSinkToken,
  InterchangeMediaSourceToken,
  ok,
  RationalTime,
  spokenLanguageSchema,
  ValidationError,
  VoiceProviderToken,
  type AsyncResult,
  type Container,
  type CreationDraft,
  type CreationProject,
} from '@taalcut/core';
import type { CreationVoiceArtifact } from '@taalcut/agent';
import { assetDuration, createRepositories, LibraryDatabaseToken } from '@taalcut/library';
import { alignCreationVoice, creationNarration, proportionalVoiceTiming } from './voice-alignment';

/** Known preflight failures never reserve a provider charge; paid failures retain their reservation. */
export function estimateCreationVoice(
  container: Container,
  project: CreationProject,
  draft: CreationDraft,
): number {
  if (project.brief.voice.mode !== 'connected') return 0;
  const text = creationNarration(draft);
  if (!text.ok || !spokenLanguageSchema.safeParse(project.brief.voice.language).success) return 0;
  if (!container.has(VoiceProviderToken) || !container.resolve(VoiceProviderToken).available().ok) return 0;
  return text.value.length * 600;
}

/** One provider read preserves performance, breath and intonation across the entire film. */
export async function createCreationVoice(
  container: Container,
  project: CreationProject,
  draft: CreationDraft,
  signal: AbortSignal,
): AsyncResult<CreationVoiceArtifact> {
  if (signal.aborted) return err(CancelledError());
  const voice = project.brief.voice;
  if (voice.mode === 'none') return ok({ assetIds: [], lines: [], usageMicros: 0 });
  if (voice.mode === 'upload') {
    if (!voice.assetId) return err(ValidationError({ field: 'voice.assetId' }));
    const found = createRepositories(container.resolve(LibraryDatabaseToken)).assets.get(voice.assetId);
    if (!found.ok) return found;
    const recording = found.value;
    const duration = assetDuration(recording);
    if (recording.trashedAt !== null || !['audio', 'video'].includes(recording.kind) || !duration)
      return err(
        ValidationError(
          { field: 'voice.assetId' },
          { detail: 'Choose an audio or video recording with a measured duration from the library.' },
        ),
      );
    const media = await container.resolve(InterchangeMediaSourceToken).resolve([voice.assetId]);
    if (!media.ok) return media;
    const asset = media.value.get(voice.assetId);
    if (!asset?.path || !asset.hasAudio)
      return err(
        ValidationError(
          { field: 'voice.assetId' },
          { detail: 'The voice recording is offline or has no audio.' },
        ),
      );
    const timing = proportionalVoiceTiming(draft, RationalTime.toSeconds(duration) * 1000);
    if (!timing.ok) return timing;
    return ok({
      assetIds: [voice.assetId],
      usageMicros: 0,
      lines: timing.value.map((line) => ({ ...line, assetId: voice.assetId! })),
    });
  }
  const narration = creationNarration(draft);
  if (!narration.ok) return narration;
  const text = narration.value;
  const language = spokenLanguageSchema.safeParse(voice.language);
  if (!language.success) return err(ValidationError({ field: 'voice.language' }));
  if (!container.has(VoiceProviderToken))
    return err(ValidationError({ field: 'voice' }, { detail: 'Connect a voice provider in Settings.' }));
  const provider = container.resolve(VoiceProviderToken);
  const availability = provider.available();
  if (!availability.ok)
    return err(
      ValidationError(
        { field: 'voice' },
        { detail: `Connected voice is unavailable: ${availability.reason}` },
      ),
    );
  let voiceId = voice.voiceId;
  if (!voiceId) {
    const voices = await provider.voices({ language: language.data, signal });
    if (!voices.ok) return voices;
    voiceId = voices.value[0]?.voiceId ?? null;
  }
  if (!voiceId)
    return err(
      ValidationError({ field: 'voiceId' }, { detail: 'The provider has no voice for this language' }),
    );
  const generated = await provider.synthesize({
    text,
    voiceId,
    language: language.data,
    quality: 'final',
    seed: 42,
    signal,
    trace: { projectId: project.projectId },
  });
  if (!generated.ok) return generated;
  const audio = generated.value;
  const usageMicros = Math.ceil(audio.costUsd * 1_000_000);
  if (!Number.isFinite(audio.costUsd) || audio.costUsd < 0 || !Number.isSafeInteger(usageMicros))
    return err(
      ValidationError({ field: 'voice.cost' }, { detail: 'The voice provider returned an invalid charge.' }),
    );
  const kept = await container.resolve(GeneratedAssetSinkToken).put({
    bytes: audio.bytes,
    mediaType: audio.mediaType,
    fileName: `creation-voice.${audio.mediaType === 'audio/mpeg' ? 'mp3' : 'wav'}`,
    projectId: project.projectId,
    provenance: {
      kind: 'generated',
      generation: 'voice',
      provider: audio.provider,
      model: audio.model,
      access: 'api-key',
      quality: 'final',
      promptSha256: createHash('sha256').update(text).digest('hex'),
      voiceId,
      providerRef: null,
      c2pa: audio.c2pa,
      costUsd: audio.costUsd,
      runId: null,
      createdAt: Date.now(),
    },
  });
  if (!kept.ok) return kept;
  const timing = alignCreationVoice(draft, text, audio.alignment);
  if (!timing.ok) return timing;
  return ok({
    assetIds: [kept.value.assetId],
    usageMicros,
    lines: timing.value.map((line) => ({
      ...line,
      assetId: kept.value.assetId,
    })),
  });
}
