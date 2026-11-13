// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which parts of a timeline a model made (SPEC P3.3): what Content Credentials may call AI and what the
 * disclosure reminder is about. Clips are generated when their asset's provenance says so; voiceover lines
 * always are (text to speech); music is when its path is `generated` or its track was generated; effects on
 * the `sfx` track by their asset. Text and motion graphics are templates filled with words, not AI. Pure.
 */
import type { AssetId, AssetProvenance, Timeline } from '@taalcut/core';

export const AI_PART_KINDS = ['clip', 'voiceover', 'music', 'sfx', 'audio'] as const;
export type AiPartKind = (typeof AI_PART_KINDS)[number];

/** One visual or audible part of the export. Titles are generic ('clip 3'): never a file name or a person. */
export interface MediaPart {
  readonly kind: AiPartKind;
  /** The timeline item id, or 'music'. */
  readonly id: string;
  /** Manifest ingredient title: 'clip 3', 'voiceover 2', 'music'. */
  readonly title: string;
  /** Manifest ingredient label: 'clip-3', 'voiceover-2', 'music'. */
  readonly label: string;
  readonly assetId: AssetId | null;
  readonly generated: boolean;
}

export interface AiInventory {
  /** Every visual and audible part, in timeline order (clips, then audio, then music). */
  readonly parts: readonly MediaPart[];
  /** The generated ones. */
  readonly generated: readonly MediaPart[];
  /** True when there is at least one part and a model made every one. */
  readonly allGenerated: boolean;
}

/** An asset's provenance kind; null when the library doesn't know the asset (counted as captured). */
export type ProvenanceKindOf = (assetId: AssetId) => AssetProvenance['kind'] | null;

const AUDIO_KIND = { voice: 'voiceover', sfx: 'sfx', clip: 'audio' } as const satisfies Record<
  string,
  AiPartKind
>;

function visualParts(timeline: Timeline, provenanceOf: ProvenanceKindOf): MediaPart[] {
  const track = timeline.tracks.find((candidate) => candidate.kind === 'video');
  if (!track?.enabled) return [];
  const parts: MediaPart[] = [];
  for (const item of track.items) {
    if (item.type === 'program' && item.enabled) {
      const index = parts.length + 1;
      parts.push({ kind: 'clip', id: item.id, title: `authored program ${index}`, label: `authored-program-${index}`, assetId: null, generated: true });
      continue;
    }
    if (item.type !== 'clip' || !item.enabled || item.media.kind === 'audio') continue;
    const index = parts.length + 1;
    parts.push({
      kind: 'clip',
      id: item.id,
      title: `clip ${index}`,
      label: `clip-${index}`,
      assetId: item.media.assetId,
      generated: provenanceOf(item.media.assetId) === 'generated',
    });
  }
  return parts;
}

function audioParts(timeline: Timeline, provenanceOf: ProvenanceKindOf): MediaPart[] {
  const voiceClips = new Set(
    (timeline.voiceover?.lines ?? []).flatMap((line) => (line.clipId ? [line.clipId] : [])),
  );
  const counts = new Map<AiPartKind, number>();
  const parts: MediaPart[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'audio' || !track.enabled) continue;
    const kind = AUDIO_KIND[track.role];
    for (const item of track.items) {
      if (item.type !== 'clip' || !item.enabled || item.audio.muted || item.media.kind === 'image') continue;
      const index = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, index);
      parts.push({
        kind,
        id: item.id,
        title: `${kind === 'sfx' ? 'sound effect' : kind} ${index}`,
        label: `${kind}-${index}`,
        assetId: item.media.assetId,
        // A voiceover line is speech a model made, whatever the library recorded for its file.
        generated: voiceClips.has(item.id) || provenanceOf(item.media.assetId) === 'generated',
      });
    }
  }
  return parts;
}

function musicPart(timeline: Timeline, provenanceOf: ProvenanceKindOf): MediaPart[] {
  const music = timeline.music;
  const base = { kind: 'music', id: 'music', title: 'music', label: 'music' } as const;
  switch (music.path) {
    case 'none':
    case 'platformSound':
      // Nothing in the file: the person adds the sound in the platform's app.
      return [];
    case 'generated':
      return [{ ...base, assetId: music.assetId, generated: true }];
    case 'ownTrack':
      return [{ ...base, assetId: music.assetId, generated: provenanceOf(music.assetId) === 'generated' }];
    case 'referenceAudio':
      return [{ ...base, assetId: null, generated: false }];
  }
}

export function aiInventory(timeline: Timeline, provenanceOf: ProvenanceKindOf): AiInventory {
  const parts = [
    ...visualParts(timeline, provenanceOf),
    ...audioParts(timeline, provenanceOf),
    ...musicPart(timeline, provenanceOf),
  ];
  const generated = parts.filter((part) => part.generated);
  return { parts, generated, allGenerated: parts.length > 0 && generated.length === parts.length };
}
