// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { MEDIA_HOST, PREVIEW_HOST } from '@taalcut/core';

export type EditsMusicTab = 'Trending' | 'For You' | 'Original audio' | 'Royalty-free' | 'Saved';
export type EditsLicenseFilter = 'any' | 'royaltyFree' | 'licensed';

export interface EditsAudioTrack {
  readonly id: string;
  readonly title: string;
  readonly artistName: string;
  readonly audioAssetId: string;
  /** Zero means the provider did not supply a usable duration. */
  readonly durationSeconds: number;
  readonly highlights: readonly number[];
  readonly isLicensedMusic: boolean;
  readonly isRoyaltyFree: boolean;
  readonly isExplicit: boolean;
  readonly isSaved: boolean;
  readonly hasPreview?: boolean;
  readonly previewUrl?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function previewUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    const local = url.protocol === 'app:' && [MEDIA_HOST, PREVIEW_HOST].includes(url.host);
    return url.protocol === 'https:' || local ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function parseHighlights(record: Record<string, unknown>, duration: number): readonly number[] {
  const raw = Array.isArray(record['highlights']) ? record['highlights'] : [];
  const segments = Array.isArray(record['highlightSegments']) ? record['highlightSegments'] : [];
  const values = [...raw, ...segments.map((entry) => asRecord(entry)?.['startSeconds'])];
  return [
    ...new Set(
      values.filter(
        (value): value is number =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          (duration === 0 || value <= duration),
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 5);
}

function parseTrack(record: Record<string, unknown>, savedIds: ReadonlySet<string>): EditsAudioTrack | null {
  const id = text(record['id']) || text(record['audioAssetId']);
  const title = text(record['title']);
  if (!id || !title) return null;
  const audioAssetId = text(record['audioAssetId']) || id;
  const rawDuration = record['durationSeconds'] ?? record['duration'];
  const durationSeconds =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const license = asRecord(record['license']);
  const preview = previewUrl(record['previewUrl']);
  return {
    id,
    title,
    artistName: text(record['artistName']),
    audioAssetId,
    durationSeconds,
    highlights: parseHighlights(record, durationSeconds),
    isRoyaltyFree: (record['isRoyaltyFree'] ?? license?.['isRoyaltyFree']) === true,
    isLicensedMusic: (record['isLicensedMusic'] ?? license?.['isLicensedMusic']) === true,
    isExplicit: record['isExplicit'] === true,
    isSaved: record['isSaved'] === true || savedIds.has(id) || savedIds.has(audioAssetId),
    ...(record['hasPreview'] === true ? { hasPreview: true } : {}),
    ...(preview ? { previewUrl: preview } : {}),
  };
}

/** Keep provider facts intact; missing fields never become demo audio or inferred music metadata. */
export function parseEditsTracks(
  payload: unknown,
  savedIds: ReadonlySet<string>,
): readonly EditsAudioTrack[] {
  const root = asRecord(payload);
  const unwrapped = asRecord(root?.['result']) ?? root;
  const list = Array.isArray(unwrapped?.['tracks']) ? unwrapped['tracks'] : [];
  return list.flatMap((item) => {
    const record = asRecord(item);
    const track = record ? parseTrack(record, savedIds) : null;
    return track ? [track] : [];
  });
}

/** A decorative timing guide; heights do not represent a measured waveform. */
export function trackCadenceBars(
  track: EditsAudioTrack,
  count = 24,
): readonly {
  readonly heightPct: number;
  readonly isHook: boolean;
  readonly timeSeconds: number;
}[] {
  const duration = Math.max(track.durationSeconds, 1);
  return Array.from({ length: count }, (_, index) => {
    const posStart = (index / count) * duration;
    const posEnd = ((index + 1) / count) * duration;
    const isHook = track.highlights.some((h) => h >= posStart && h < posEnd);
    return { heightPct: isHook ? 96 : 40, isHook, timeSeconds: (posStart + posEnd) / 2 };
  });
}

export function buildAgentPromptFromTrack(track: EditsAudioTrack): string {
  const title = track.title;
  const artist = track.artistName;
  const audioAssetId = track.audioAssetId;
  const parts = [
    t`Make a vertical reel using the Instagram Edits track "${title}" (audioAssetId: ${audioAssetId}).`,
  ];
  if (artist) parts.push(t`Artist: ${artist}.`);
  if (track.durationSeconds > 0) {
    const duration = i18n.number(track.durationSeconds);
    parts.push(t`The supplied track duration is ${duration} seconds.`);
  }
  if (track.highlights.length > 0) {
    const timestamps = new Intl.ListFormat(i18n.locale).format(
      track.highlights.map((time) => i18n.number(time)),
    );
    parts.push(t`Use the supplied timing markers at ${timestamps} seconds to plan transitions.`);
  }
  parts.push(t`Build the edit from my available footage and prepare it for Instagram Edits.`);
  return parts.join(' ');
}

export function buildCreateSearchFromTrack(track: EditsAudioTrack): {
  category: 'custom';
  title: string;
  prompt: string;
  duration?: number;
  audioAssetId: string;
} {
  const title = track.title;
  return {
    category: 'custom',
    title: t`${title} — Reel cut`,
    ...(track.durationSeconds > 0
      ? { duration: Math.max(5, Math.min(600, Math.round(track.durationSeconds))) }
      : {}),
    audioAssetId: track.audioAssetId,
    prompt: buildAgentPromptFromTrack(track),
  };
}
