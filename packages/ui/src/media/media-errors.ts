// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words for the errors the media cards meet (a capture or a graphic that is gone, and a consent recording made
 * somewhere else). Audio's other voice errors and render's graphic errors read as the kit's error words say
 * (error-words-media.ts, error-words-library.ts: FIX-ERRWORDS moved them there, word for word, so chat says them too).
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { TaalcutError } from '@taalcut/core';
import { errorMessage } from '../feedback/error-messages';

const MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  // The card's own words: the recording is made right here. Elsewhere the kit's errors.audio.clone_source_refused.
  'audio.clone_source_refused': msg`Only the recording made in this card can become your voice. Record it again.`,
};

const GONE: Readonly<Record<string, MessageDescriptor>> = {
  graphic: msg`The graphic isn’t on the timeline now.`,
  voiceCapture: msg`The recording stopped before it was saved. Record it again.`,
  voiceConsent: msg`That consent isn’t saved on this Mac now.`,
  timeline: msg`This video was deleted.`,
};

export function mediaErrorMessage(i18n: I18n, error: TaalcutError): string {
  const own = MESSAGES[error.code];
  if (own) return i18n._({ ...own, values: error.params });
  const entity = error.params?.['entity'];
  const gone =
    error.code === 'core.not_found' && typeof entity === 'string'
      ? GONE[entity]
      : error.code === 'timeline.not_found'
        ? GONE['timeline']
        : undefined;
  return gone ? i18n._(gone) : errorMessage(i18n, error);
}
