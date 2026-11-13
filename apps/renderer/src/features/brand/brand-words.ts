// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The brand kit pages' words (P3-V10): corners, what a refused image or a refused change means, and where a kit
 * is used. Counts and sizes go through Intl (plural rules too).
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { LOGO_LIMITS, type STYLE_CORNERS, type TaalcutError } from '@taalcut/core';
import { errorMessage } from '@taalcut/ui';
import { formatBytes } from '../shared/format';

export type Corner = (typeof STYLE_CORNERS)[number];

export const CORNER_LABELS: Readonly<Record<Corner, MessageDescriptor>> = {
  topLeft: msg`Top left`,
  topRight: msg`Top right`,
  bottomLeft: msg`Bottom left`,
  bottomRight: msg`Bottom right`,
};

/** Why styles.importImage refused a picked image, and what to do instead. */
export function imageRefusal(i18n: I18n, reason: string): string {
  switch (reason) {
    case 'size': {
      const most = formatBytes(i18n, LOGO_LIMITS.bytes);
      return i18n._(msg`That image is larger than ${most}. Pick a smaller file.`);
    }
    case 'pixels': {
      const side = i18n.number(LOGO_LIMITS.pixels);
      return i18n._(msg`That image is more than ${side} pixels on a side. Pick a smaller one.`);
    }
    default:
      return i18n._(msg`Taalcut can use a PNG, JPEG or WebP image. Pick another file.`);
  }
}

/** "2 videos and 1 template": what names a kit (styles.usedBy, templates.style_in_use). */
export function usageWords(i18n: I18n, usage: { timelines: number; templates: number }): string {
  const videos = i18n._(msg`${plural(usage.timelines, { one: '# video', other: '# videos' })}`);
  const templates = i18n._(msg`${plural(usage.templates, { one: '# template', other: '# templates' })}`);
  if (usage.timelines > 0 && usage.templates > 0) return i18n._(msg`${videos} and ${templates}`);
  return usage.timelines > 0 ? videos : templates;
}

const count = (value: unknown) => (typeof value === 'number' ? value : 0);

/** A refused style change in words; anything else as the app says errors. */
export function styleErrorMessage(i18n: I18n, error: TaalcutError): string {
  switch (error.code) {
    case 'templates.style_image_invalid':
      return imageRefusal(i18n, String(error.params?.['reason'] ?? 'type'));
    case 'templates.style_in_use': {
      const where = usageWords(i18n, {
        timelines: count(error.params?.['timelines']),
        templates: count(error.params?.['templates']),
      });
      return i18n._(msg`It’s still used by ${where}. Give them another look first, then delete it.`);
    }
    case 'templates.style_not_found':
    case 'timeline.style_not_found':
      return i18n._(msg`That brand kit is gone. It may have been deleted in another window.`);
    case 'core.conflict':
      return i18n._(
        msg`This brand kit changed somewhere else just now. You’re seeing it as it is; try again.`,
      );
    default:
      return errorMessage(i18n, error);
  }
}
