// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio type from evidence. First match wins (config v1). "Under" is strict:
 * −50.0 LUFS is not silent, and a 0.1 non-silent ratio is not silent.
 */
import { AUDIO_CONFIG } from '../config';
import type { AudioKind } from './labels';
import type { AudioClassification, AudioEvidence } from './types';

export function classifyAudio(evidence: AudioEvidence): AudioClassification {
  const { silence, classify } = AUDIO_CONFIG;
  const loudnessSilent = evidence.integratedLufs !== null && evidence.integratedLufs < silence.silentLufs;
  const ratioSilent = evidence.nonSilentRatio < silence.minNonSilentRatio;
  let kind: AudioKind;
  if (loudnessSilent || ratioSilent) kind = 'silent';
  else if (evidence.musicScore >= classify.musicScoreMin && evidence.speechRatio < classify.musicSpeechMax) {
    kind = 'music';
  } else if (evidence.speechRatio >= classify.voiceSpeechMin && evidence.musicScore < classify.voiceMusicMax) {
    kind = 'voice';
  } else if (evidence.speechRatio >= classify.mixedSpeechMin && evidence.musicScore >= classify.mixedMusicMin) {
    kind = 'mixed';
  } else kind = 'original';

  return {
    kind,
    silent: kind === 'silent',
    evidence,
    ...(kind === 'music' ? { transcriptDropped: 'music' as const } : {}),
  };
}
