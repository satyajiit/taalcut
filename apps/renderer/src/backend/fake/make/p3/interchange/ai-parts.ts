// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export dialog's Content Credentials note as render works it out (render's router/export-credentials.ts and
 * credentials/ai-inventory.ts): the project's choice, how many of the timeline's originals carry their own
 * credentials, and every platform's disclosure reminder whenever a model made any part of the export (clips by
 * their asset's provenance, voiceover lines always, music on the generated path, effects by their asset).
 */
import {
  PLATFORMS,
  type AssetId,
  type AssetProvenance,
  type ExportCredentials,
  type ProjectId,
  type Timeline,
} from '@taalcut/core';
import { exportState } from './export-state';

/** Where an asset came from; null when nothing says (the fake library's own clips: captured). */
export type ProvenanceOf = (assetId: AssetId) => AssetProvenance | null;

export const knownProvenance: ProvenanceOf = (assetId) => exportState().provenance.get(assetId) ?? null;

/** The distinct assets a timeline shows or plays, music included. */
export function timelineAssetIds(timeline: Timeline): AssetId[] {
  const ids = new Set<AssetId>();
  for (const track of timeline.tracks)
    for (const item of track.items) if ('media' in item) ids.add(item.media.assetId);
  if (timeline.music.path === 'ownTrack' || timeline.music.path === 'generated')
    ids.add(timeline.music.assetId);
  return [...ids];
}

const isGenerated = (provenanceOf: ProvenanceOf, assetId: AssetId) =>
  provenanceOf(assetId)?.kind === 'generated';

/** True when a model made a part the export shows or plays (render's AI inventory isn't empty). */
export function hasGeneratedPart(timeline: Timeline, provenanceOf: ProvenanceOf): boolean {
  if (timeline.music.path === 'generated') return true;
  if (timeline.music.path === 'ownTrack' && isGenerated(provenanceOf, timeline.music.assetId)) return true;
  const voiceClips = new Set((timeline.voiceover?.lines ?? []).flatMap((line) => line.clipId ?? []));
  return timeline.tracks.some(
    (track) =>
      track.kind !== 'text' &&
      track.enabled &&
      track.items.some(
        (item) =>
          item.type === 'clip' &&
          item.enabled &&
          (voiceClips.has(item.id) || isGenerated(provenanceOf, item.media.assetId)) &&
          (track.kind === 'video' ? item.media.kind !== 'audio' : !item.audio.muted),
      ),
  );
}

/** Originals that carry their own manifest: generated files the provider signed (read at ingest). */
function signedOriginals(timeline: Timeline, provenanceOf: ProvenanceOf): number {
  return timelineAssetIds(timeline).filter((assetId) => {
    const provenance = provenanceOf(assetId);
    return provenance?.kind === 'generated' && provenance.c2pa === 'present';
  }).length;
}

export function exportCredentialsFor(
  projectId: ProjectId,
  timeline: Timeline,
  provenanceOf: ProvenanceOf = knownProvenance,
): ExportCredentials {
  return {
    add: exportState().credentials.get(projectId) ?? false,
    sourcesWithCredentials: signedOriginals(timeline, provenanceOf),
    disclosures: hasGeneratedPart(timeline, provenanceOf) ? [...PLATFORMS] : [],
  };
}
