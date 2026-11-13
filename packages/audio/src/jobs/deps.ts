// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the jobs process injects. Whisper paths may be empty strings in tests;
 * constructing the handlers does not open a binary or a model.
 */
import type { CloudSpeechToText, ComputeFallbackEvent } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { AssetAudioStore } from '../asset-audio/asset-audio-store';
import type { BeatOnnxRuntime } from '../beats/types';
import type { VadEngine } from '../cleanup/vad';
import type { SpeechSidecar } from '../speech/engine';
import type { IndicLid } from '../speech/indic-lid';
import type { SpeechSettings } from '../speech/cloud-engine';
import type { WhisperDecoder } from '../whisper/decoder';

export interface AudioJobDeps {
  readonly media: MediaContext;
  readonly settings: SpeechSettings;
  readonly cloud?: CloudSpeechToText;
  readonly sidecar?: SpeechSidecar;
  readonly sherpa?: { runtimeDir: string; modelDir: string };
  readonly whisper: { binary: string; tiny: string; small: string; medium: string };
  readonly beats: { onnx: BeatOnnxRuntime; modelDir: string };
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Route changes that aren't CPU fallbacks (Parakeet missing, so whisper on Metal). */
  readonly log?: (message: string) => void;
}

/** What the indexing kinds need besides (IX-A1…A3). One of each per jobs process, shared by every job. */
export interface AudioIndexJobDeps extends AudioJobDeps {
  /** Each asset's audio pass (loudness, silences, the speech PCM), kept between language ID and transcript. */
  readonly store: AssetAudioStore;
  /** The persistent whisper (one server per model). Absent: whisper-cli, a process per call. */
  readonly decoder?: WhisperDecoder;
  /** Silero VAD. Absent (its component isn't installed): the non-silent stretches stand in for voice. */
  readonly vad?: VadEngine;
  /**
   * The Indian-language identifier (LIB1-LANG). Absent when its component isn't installed, or when nothing the person
   * speaks needs it: then Whisper decides alone, with its floor.
   */
  readonly indicLid?: IndicLid;
  /** The languages the person speaks (read per job), the language decision's prior. Absent: none. */
  readonly spokenLanguages?: () => Promise<readonly string[]>;
}
