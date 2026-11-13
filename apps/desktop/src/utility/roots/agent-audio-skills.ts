// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's skills for the agent's skill registry (agent-flows.ts): the Voice director (P3-B6), where its tools are
 * registered (agent-audio.ts): stored timelines and a library that keeps generated files. Its coverage check reads
 * the voice lines' transcripts from the library (each generated line lands with its words, round P3-3), the same
 * reader render rebuilds captions with.
 */
import { TimelineStoreToken, type Container, type SkillModule } from '@taalcut/core';
import { createVoiceSkillModule, type VoiceSkillDeps } from '@taalcut/audio';
import { renderTranscripts } from '../../shared/render-ports';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { generationPrices } from './agent-audio-prices';
import { canGenerate } from './agent-audio-services';

/** The Voice director's dependencies in this process; the transcripts only where a library is open. */
export function voiceSkillDeps(container: Container): VoiceSkillDeps {
  return {
    timelines: container.resolve(TimelineStoreToken),
    prices: generationPrices,
    ...(container.has(LibraryDatabaseToken) ? { transcripts: renderTranscripts(container) } : {}),
  };
}

export function audioAgentSkills(container: Container): SkillModule[] {
  if (!container.has(TimelineStoreToken) || !canGenerate(container)) return [];
  return [createVoiceSkillModule(voiceSkillDeps(container))];
}
