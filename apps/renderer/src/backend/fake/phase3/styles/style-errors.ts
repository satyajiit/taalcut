// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The errors the real style handlers answer with (packages/templates src/errors.ts, packages/timeline
 * src/errors.ts), built as plain TaalcutErrors: the page can't import those packages, and core's defineError
 * would register their codes a second time.
 */
import type { TaalcutError } from '@taalcut/core';

const error = (code: string, params?: TaalcutError['params']): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable: false,
  ...(params ? { params } : {}),
});

/** templates' StyleNotFound: style.*, template.setStyle and the styles reads. */
export const styleNotFound = () => error('templates.style_not_found');
/** templates' StyleInUse: style.delete while timelines or template versions name it. */
export const styleInUse = (usage: { timelines: number; templates: number }) =>
  error('templates.style_in_use', usage);
/** templates' StyleImageInvalid: styles.importImage refused the picked image. */
export const styleImageInvalid = (reason: 'type' | 'size' | 'pixels') =>
  error('templates.style_image_invalid', { reason });
/** timeline's StyleNotFound: timeline.setStyle and batch.applyStyle, naming the Style. */
export const timelineStyleNotFound = (styleId: string) => error('timeline.style_not_found', { styleId });
/** timeline's TimelineNotFound: a batch item that isn't there, or isn't in the project it names. */
export const timelineNotFound = (timelineId: string) => error('timeline.not_found', { timelineId });
