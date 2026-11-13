// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- provider text and credit lines as a library records them: data */

/**
 * For tests and screenshots: a timeline as Phase 3 leaves it, so every export section has something to show. The
 * agent would get it here through voice.applyVoiceover, music.choosePath (generated), sfx.setHits,
 * timeline.setReframe and a stock import; this writes the same document in one new revision (announced like any
 * change) and records what the library would know about the assets: one clip from Pexels, one effect from
 * Freesound under CC BY, the music generated (and signed by its provider).
 */
import {
  newId,
  RationalTime,
  TimeRange,
  type AssetId,
  type AssetProvenance,
  type Clip,
  type FrameRate,
  type ProjectId,
  type SequenceItem,
  type Timeline,
  type TimelineId,
  type Track,
} from '@taalcut/core';
import type { FakeTimelines } from '../../fake-timelines';
import type { ExportFakeState } from './export-state';

const HEX = 'a3'.repeat(32);

function audioClip(assetId: AssetId, frames: number, rate: FrameRate): Clip {
  return {
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'audio',
      assetId,
      available: TimeRange.of(RationalTime.zero(rate), RationalTime.of(frames * 4, rate)),
    },
    sourceStart: RationalTime.zero(rate),
    duration: RationalTime.of(frames, rate),
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: -6, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

/** Clips `frames` long at each start, gaps between: an audio track's items. */
function placed(
  starts: readonly number[],
  frames: number,
  assetId: AssetId,
  rate: FrameRate,
): SequenceItem[] {
  const items: SequenceItem[] = [];
  let cursor = 0;
  for (const start of starts) {
    if (start > cursor)
      items.push({
        type: 'gap',
        id: newId<'TimelineItem'>(),
        duration: RationalTime.of(start - cursor, rate),
        slotId: null,
      });
    items.push(audioClip(assetId, frames, rate));
    cursor = start + frames;
  }
  return items;
}

const pexels = (author: string): AssetProvenance => ({
  kind: 'stock',
  provider: 'pexels',
  providerAssetId: '7710243',
  licence: 'Pexels-Licence',
  rawLicence: 'Pexels-Licence',
  author,
  authorUrl: 'https://www.pexels.com/@ana-lima/',
  sourceUrl: 'https://www.pexels.com/video/7710243/',
  attribution: '',
  fetchedAt: 1_760_400_000_000,
});

const freesound: AssetProvenance = {
  kind: 'stock',
  provider: 'freesound',
  providerAssetId: '612091',
  licence: 'CC-BY-4.0',
  rawLicence: 'Attribution',
  author: 'kinoton',
  authorUrl: 'https://freesound.org/people/kinoton/',
  sourceUrl: 'https://freesound.org/s/612091/',
  attribution: '"Whoosh short" by kinoton (https://freesound.org/s/612091/) licensed under CC BY 4.0',
  fetchedAt: 1_760_400_000_000,
};

const generated = (generation: 'voice' | 'music'): AssetProvenance => ({
  kind: 'generated',
  generation,
  provider: 'elevenlabs',
  model: generation === 'voice' ? 'eleven_v3' : 'music_v1',
  access: 'api-key',
  quality: generation === 'voice' ? 'final' : null,
  promptSha256: HEX,
  voiceId: generation === 'voice' ? 'JBFqnCBsd6RMkjVDRZzb' : null,
  providerRef: null,
  c2pa: generation === 'music' ? 'present' : 'absent',
  costUsd: 0.12,
  runId: null,
  createdAt: 1_760_400_000_000,
});

/** Puts the voiceover, the hits, three reframed clips, generated music and the provenance on `timelineId`. */
export function showcaseExport(
  timelines: FakeTimelines,
  state: ExportFakeState,
  /** Library assets to play the voice, the music and the effects from. */
  library: readonly AssetId[],
  projectId: ProjectId,
  timelineId: TimelineId,
): boolean {
  const doc = timelines.get(timelineId);
  if (!doc || doc.projectId !== projectId) return false;
  const rate = doc.canvas.rate;
  const video = doc.tracks.find((track) => track.kind === 'video');
  const clips = (video?.items ?? []).filter((item): item is Clip => item.type === 'clip');
  const [first, second, third] = clips;
  if (!video || !first || !second || !third) return false;
  const reframed = new Set([first.id, second.id, third.id]);
  const used = new Set(clips.map((clip) => clip.media.assetId));
  const spare = library.filter((assetId) => !used.has(assetId));
  const [voiceAsset, musicAsset, effectsAsset] = spare;
  if (!voiceAsset || !musicAsset || !effectsAsset) return false;
  const voice: Track = {
    kind: 'audio',
    id: 'A2',
    name: 'Voice',
    enabled: true,
    role: 'voice',
    items: placed([15, 120], 75, voiceAsset, rate),
  };
  const effects: Track = {
    kind: 'audio',
    id: 'A3',
    name: 'Sound effects',
    enabled: true,
    role: 'sfx',
    items: placed([28, 58, 90], 12, effectsAsset, rate),
  };
  const lines = voice.items.filter((item): item is Clip => item.type === 'clip');
  const next: Timeline = {
    ...doc,
    tracks: [
      ...doc.tracks
        .filter((track) => !(track.kind === 'audio' && (track.role === 'voice' || track.role === 'sfx')))
        .map((track) =>
          track === video
            ? {
                ...video,
                items: video.items.map((item) =>
                  item.type === 'clip' && reframed.has(item.id)
                    ? { ...item, reframe: { mode: 'auto' as const, nudge: { x: 0, y: 0 }, scale: 1 } }
                    : item,
                ),
              }
            : track,
        ),
      voice,
      effects,
    ],
    voiceover: {
      id: newId<'Voiceover'>(),
      voiceId: 'JBFqnCBsd6RMkjVDRZzb',
      voiceName: 'Meera',
      own: false,
      language: 'en',
      seed: 7,
      lines: lines.map((line, index) => ({
        id: newId<'VoiceLine'>(),
        text: index === 0 ? 'Golden hour at the market.' : 'Chai for forty, and the light is free.',
        slotId: null,
        clipId: line.id,
        assetId: voiceAsset,
        quality: 'final' as const,
        offBeat: false,
        duration: line.duration,
      })),
    },
    music: {
      path: 'generated',
      assetId: musicAsset,
      warpedKey: `warped/a3/${HEX}.v1.flac`,
      bpm: 120,
      grid: { maxErrorMs: 6, p95ErrorMs: 3, missed: 0 },
      gainDb: -8,
    },
  };
  timelines.replace(projectId, next);
  state.provenance.set(effectsAsset, freesound);
  state.provenance.set(second.media.assetId, pexels('Ana Lima'));
  state.provenance.set(voiceAsset, generated('voice'));
  state.provenance.set(musicAsset, generated('music'));
  // music.generate warped the track onto the beat map and left the file in the media cache.
  if (next.music.path === 'generated') state.warpedMusic.add(next.music.warpedKey);
  return true;
}
