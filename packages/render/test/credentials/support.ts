// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Timelines with generated parts for the Content Credentials tests: roles, a voiceover and music paths. */
import {
  fromMilliseconds,
  newId,
  type AssetId,
  type AssetProvenance,
  type MusicChoice,
  type Timeline,
  type Voiceover,
} from '@taalcut/core';
import { makeTimeline } from '../support/timeline';
import type { ProvenanceKindOf } from '../../src/credentials/ai-inventory';

export interface PartsSpec {
  /** One V1 clip per entry; true makes its asset generated. */
  readonly clips: readonly boolean[];
  /** Audio tracks by role, each a list of clips (true: a generated asset). */
  readonly voice?: readonly boolean[];
  readonly sfx?: readonly boolean[];
  /** Voice clips that are voiceover lines (indexes into `voice`). */
  readonly voiceoverLines?: readonly number[];
  readonly music?: 'platformSound' | 'ownTrack' | 'generatedTrack' | 'generated' | 'referenceAudio';
}

export interface Parts {
  readonly timeline: Timeline;
  readonly provenanceOf: ProvenanceKindOf;
}

function music(kind: PartsSpec['music'], generatedAssets: Set<AssetId>): MusicChoice {
  switch (kind ?? 'platformSound') {
    case 'ownTrack':
    case 'generatedTrack': {
      const assetId = newId<'Asset'>();
      if (kind === 'generatedTrack') generatedAssets.add(assetId);
      return { path: 'ownTrack', assetId, offset: { value: 0, rate: { num: 30, den: 1 } }, gainDb: 0 };
    }
    case 'generated':
      return {
        path: 'generated',
        assetId: newId<'Asset'>(),
        warpedKey: `warped/ab/${'ab'.repeat(32)}.v1.flac`,
        bpm: 120,
        grid: { maxErrorMs: 1, p95ErrorMs: 1, missed: 0 },
        gainDb: 0,
      };
    case 'referenceAudio':
      return { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: 0 };
    default:
      return { path: 'platformSound' };
  }
}

export function partsTimeline(spec: PartsSpec): Parts {
  const generated = new Set<AssetId>();
  const asset = (isGenerated: boolean) => {
    const id = newId<'Asset'>();
    if (isGenerated) generated.add(id);
    return id;
  };
  const roles = [...(spec.voice ? ['voice' as const] : []), ...(spec.sfx ? ['sfx' as const] : [])];
  const base = makeTimeline({
    items: spec.clips.map((isGenerated) => ({ frames: 30, assetId: asset(isGenerated) })),
    audioTracks: roles.map((role) =>
      ((role === 'voice' ? spec.voice : spec.sfx) ?? []).map((isGenerated) => ({
        frames: 20,
        assetId: asset(isGenerated),
      })),
    ),
    music: music(spec.music, generated),
  });
  let audioIndex = 0;
  const tracks = base.tracks.map((track) =>
    track.kind === 'audio' ? { ...track, role: roles[audioIndex++] ?? track.role } : track,
  );
  const voiceTrack = tracks.find((track) => track.kind === 'audio' && track.role === 'voice');
  const voiceItems = voiceTrack?.items ?? [];
  const voiceover: Voiceover | null = spec.voiceoverLines
    ? {
        id: newId<'Voiceover'>(),
        voiceId: 'voice-1',
        voiceName: 'Narrator',
        own: false,
        language: 'en',
        seed: 1,
        lines: spec.voiceoverLines.map((index) => ({
          id: newId<'VoiceLine'>(),
          text: `Line ${index}`,
          slotId: null,
          clipId: voiceItems[index]?.type === 'clip' ? voiceItems[index].id : null,
          assetId: null,
          quality: 'final',
          // A voice line's length is on its clip's clock (contract P3-2): 0.6 s.
          duration: fromMilliseconds(600),
          offBeat: false,
        })),
      }
    : null;
  const timeline = { ...base, tracks, voiceover };
  const provenanceOf: ProvenanceKindOf = (assetId): AssetProvenance['kind'] =>
    generated.has(assetId) ? 'generated' : 'captured';
  return { timeline, provenanceOf };
}
