// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export sections' words for keys the backend sends: the per-platform AI disclosure reminders, the pro export
 * formats, and an interchange file's warnings grouped by kind ("3 text items become markers"). Keys resolve
 * through the catalogue (render-messages-phase3.ts), English as the fallback.
 */
import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { InterchangeFormatInfo, InterchangeWarning, Platform } from '@taalcut/core';
import { RENDER_MESSAGES_PHASE3 } from '../render-messages-phase3';

const BY_ID = new Map(
  RENDER_MESSAGES_PHASE3.flatMap((descriptor) => (descriptor.id ? [[descriptor.id, descriptor]] : [])),
);

/** The catalogue's words for a key this lane knows, else the key's English fallback, else the key's own label. */
function known(i18n: I18n, key: string, fallback: string): string {
  if (key in i18n.messages) return i18n._(key);
  const descriptor = BY_ID.get(key);
  return descriptor ? i18n._(descriptor) : fallback;
}

export const disclosureTitle = (i18n: I18n, platform: Platform) =>
  known(i18n, `render.disclosure.${platform}.title`, platform);

export const disclosureSteps = (i18n: I18n, platform: Platform) =>
  known(i18n, `render.disclosure.${platform}.steps`, '');

/** "Final Cut Pro 12 (.fcpxml)"; a format newer than these words shows its extension. */
export const formatLabel = (i18n: I18n, format: InterchangeFormatInfo) =>
  known(i18n, format.labelKey, format.fileExtension);

/** The warnings of one file, one sentence per kind, in the order they first appear. */
export function warningLines(i18n: I18n, warnings: readonly InterchangeWarning[]): string[] {
  const counts = new Map<InterchangeWarning['code'], number>();
  for (const warning of warnings)
    counts.set(
      warning.code,
      (counts.get(warning.code) ?? 0) + (warning.code === 'textAsMarker' ? warning.count : 1),
    );
  return [...counts].map(([code, count]) => {
    switch (code) {
      case 'mediaOffline':
        return i18n._(
          msg`${plural(count, {
            one: '# clip’s original is offline: the editor will ask you to find it.',
            other: '# clips’ originals are offline: the editor will ask you to find them.',
          })}`,
        );
      case 'rampApproximated':
        return i18n._(
          msg`${plural(count, {
            one: '# speed change is kept as a note: that clip plays at normal speed there.',
            other: '# speed changes are kept as notes: those clips play at normal speed there.',
          })}`,
        );
      case 'transitionAsCut':
        return i18n._(
          msg`${plural(count, {
            one: '# transition becomes a plain cut, with a marker where it was.',
            other: '# transitions become plain cuts, with a marker where each was.',
          })}`,
        );
      case 'textAsMarker':
        return i18n._(
          msg`${plural(count, {
            one: '# text item becomes a marker with its words.',
            other: '# text items become markers with their words.',
          })}`,
        );
      case 'imageAsStill':
        return i18n._(
          msg`${plural(count, {
            one: '# photo comes in as a still frame.',
            other: '# photos come in as still frames.',
          })}`,
        );
    }
  });
}
