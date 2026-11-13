// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Own-voice consent in the agent process (P3-B6, packages/audio SPEC P3.3): `voice.recordConsent`,
 * `voice.withdrawConsent`, `voice.createClone` and `voice.deleteClone` over the library's consent store, main's
 * voice capture files (claimed once), the voice provider, and a local transcriber: the recording's first 20 s go
 * through whisper on this Mac as a job in the jobs process, never the cloud. No consent store, no commands: the
 * consent card's buttons then answer that recording isn't available.
 */
import {
  callRpc,
  ClockToken,
  FrameRate,
  JobRunnerToken,
  ok,
  RationalTime,
  TimeRange,
  VoiceConsentStoreToken,
  VoiceProviderToken,
  type AnyCommand,
  type Container,
} from '@taalcut/core';
import {
  audioTranscribeWhisperJob,
  createConsentCommands,
  type LocalTranscriber,
  type VoiceCaptureFiles,
} from '@taalcut/audio';
import { AgentMainServicesToken } from '../../shared/tokens';

const MS = FrameRate.of(1000, 1);

/** whisper's language codes are base subtags: pt-BR is pt. */
const whisperLanguage = (language: string) => language.split('-')[0] ?? language;

function whisperTranscriber(container: Container): LocalTranscriber {
  return {
    async transcribe(path, { language, maxMs, signal }) {
      const heard = await container.resolve(JobRunnerToken).run(
        audioTranscribeWhisperJob,
        {
          path,
          language: whisperLanguage(language),
          model: 'small',
          range: TimeRange.of(RationalTime.zero(MS), RationalTime.of(maxMs, MS)),
        },
        signal ? { signal } : {},
      );
      return heard.ok ? ok(heard.value.segments.map((segment) => segment.text.trim()).join(' ')) : heard;
    },
  };
}

/** Main's capture files: the path of a finished recording, once. */
function mainCaptures(container: Container): VoiceCaptureFiles {
  const main = container.resolve(AgentMainServicesToken);
  return { claim: (captureKey) => callRpc(main().voiceCaptureFiles.claim({ captureKey })) };
}

export function consentCommands(container: Container): AnyCommand[] {
  if (
    !container.has(VoiceConsentStoreToken) ||
    !container.has(VoiceProviderToken) ||
    !container.has(AgentMainServicesToken)
  )
    return [];
  return [
    ...createConsentCommands({
      consents: container.resolve(VoiceConsentStoreToken),
      captures: mainCaptures(container),
      transcriber: whisperTranscriber(container),
      provider: container.resolve(VoiceProviderToken),
      clock: container.resolve(ClockToken),
      providerName: 'elevenlabs',
    }).all,
  ];
}
