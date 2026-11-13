// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- format versions, file extensions and file names: data, not UI */

/**
 * Pro export as the timeline package and the agent's export sink answer it (P3-V5): the two writers this build
 * ships (OTIO 0.18.1 for Resolve and Premiere, FCPXML 1.14 for Final Cut), the warnings each file carries
 * (timeline's interchange/warnings.ts: offline originals, speed, transitions written as cuts, text as markers,
 * stills), and the file's name in Taalcut's exports folder (`<project> – <timeline>.<ext>`, `… 2` when taken).
 */
import type {
  AssetId,
  InterchangeFormat,
  InterchangeFormatInfo,
  InterchangeWarning,
  Timeline,
} from '@taalcut/core';

export const INTERCHANGE_FORMATS_INFO: readonly InterchangeFormatInfo[] = [
  { id: 'otio', version: '0.18.1', fileExtension: '.otio', labelKey: 'interchange.otio.label' },
  { id: 'fcpxml', version: '1.14', fileExtension: '.fcpxml', labelKey: 'interchange.fcpxml.label' },
];

/** What another editor won't get exactly as Taalcut plays it. `online` says whether an original is reachable. */
export function interchangeWarnings(
  timeline: Timeline,
  online: (assetId: AssetId) => boolean,
): InterchangeWarning[] {
  const out: InterchangeWarning[] = [];
  let texts = 0;
  for (const track of timeline.tracks) {
    if (track.kind === 'text') {
      texts += track.items.filter((item) => item.type === 'text').length;
      continue;
    }
    for (const item of track.items) {
      // Both writers set transitions as plain cuts plus a marker in v1.
      if (item.type === 'transition') out.push({ code: 'transitionAsCut', itemId: item.id });
      if (item.type !== 'clip') continue;
      if (!online(item.media.assetId)) out.push({ code: 'mediaOffline', clipId: item.id });
      if (item.speed) out.push({ code: 'rampApproximated', clipId: item.id });
      if (item.media.kind === 'image') out.push({ code: 'imageAsStill', clipId: item.id });
    }
  }
  if (texts > 0) out.push({ code: 'textAsMarker', count: texts });
  return out.slice(0, 500);
}

/** A plain file stem: no separators, control characters or leading dots, one space between words. */
function stem(text: string): string {
  const cleaned = text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .replace(/[/\\:]/g, '-')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'Export';
}

/** The sink's name for a new file, never one already there; null past `… 999` (the sink's core.conflict). */
export function exportFileName(
  projectName: string | null,
  timeline: Timeline,
  format: InterchangeFormat,
  taken: ReadonlySet<string>,
): string | null {
  const extension =
    INTERCHANGE_FORMATS_INFO.find((info) => info.id === format)?.fileExtension ?? `.${format}`;
  const name = stem(projectName ? `${projectName} – ${timeline.name}` : timeline.name);
  for (let copy = 1; copy <= 999; copy++) {
    const candidate = copy === 1 ? `${name}${extension}` : `${name} ${copy}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}
