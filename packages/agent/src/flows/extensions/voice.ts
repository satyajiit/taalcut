// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `voice` extension (SPEC sections 25 and 28, P3-B6 agent half): after the Editor, the Voice director
 * (`voice.director`, declared by @taalcut/audio) joins when the start or the brief asks for a voiceover, or
 * the template's audio kind is voice, and only while the voice module can run. A voiceover asked for later
 * ("add a voiceover saying …") is an ordinary plan step the model names.
 */
import { ok, type AsyncResult, type FORMAT_AUDIO } from '@taalcut/core';
import { flowFacts } from '../../flows';
import type { RunState } from '../../run-state';
import type { FlowExtension } from '../extensions';

export const VOICE_EXTENSION = 'voice';
export const VOICE_SKILL = 'voice.director';

export interface VoiceExtensionDeps {
  /** The voice module can run now: a voice model is configured and Local only is off. */
  readonly available: () => boolean;
  /** The audio kind of a stored template (its format's), when known. */
  readonly templateAudio?: (
    templateId: string,
    signal: AbortSignal,
  ) => AsyncResult<(typeof FORMAT_AUDIO)[number] | null>;
}

/** "voiceover", "narration", "voz en off", "narração", "वॉइसओवर" …: a request for a spoken track, in the four v1 languages. */
const ASKS_FOR_VOICE =
  /\b(voice[- ]?over|narrat(?:e|ed|ion|or)|talk over it|in my (?:own )?voice|voz en off|locuci[oó]n|narraci[oó]n|narrador|con mi voz|voz em off|locu[cç][aã]o|narra[cç][aã]o|com a minha voz)\b|वॉइसओवर|वॉयसओवर|नैरेशन|मेरी आवाज़/iu;

const textOf = (value: unknown): string =>
  value !== null && typeof value === 'object' && 'text' in value && typeof value.text === 'string'
    ? value.text
    : '';

/** Did the user's words (the message, or the brief they gave or accepted) ask for a voiceover? */
export function asksForVoiceover(state: RunState): boolean {
  const given = textOf(state.flow?.input?.brief);
  const proposed = textOf(state.plan?.find((s) => s.flow?.key === 'brief')?.handedOff?.output);
  return ASKS_FOR_VOICE.test([state.started?.message ?? '', given, proposed].join('\n'));
}

export function voiceExtension(deps: VoiceExtensionDeps): FlowExtension {
  return {
    id: VOICE_EXTENSION,
    anchor: { after: 'editor' },
    step: { skill: VOICE_SKILL, labelKey: 'skills.voice.director' },
    async when(state, ctx) {
      if (!deps.available()) return ok({ join: false });
      if (asksForVoiceover(state)) return ok({ join: true });
      const templateId = flowFacts(state, ctx.anchor).templateId;
      if (!deps.templateAudio || typeof templateId !== 'string') return ok({ join: false });
      const audio = await deps.templateAudio(templateId, ctx.signal);
      if (!audio.ok) return audio;
      return ok({ join: audio.value === 'voice' });
    },
  };
}
