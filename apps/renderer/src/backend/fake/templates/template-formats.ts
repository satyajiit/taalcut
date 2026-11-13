// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The built-in formats `templates.formats` serves: all eight of @taalcut/templates' FORMAT_SUMMARIES, value for
 * value (the catalogue names them by key). The renderer can't import templates, so the list is copied here;
 * scripts/fakes/fake-parity.test.ts deep-equals it with the templates package's.
 */
import type { FormatId, FormatSummary } from '@taalcut/core';

type Facts = Pick<FormatSummary, 'defaultBpm' | 'audio' | 'captions'>;

/** Every format plans 6 to 120 s on a beat grid; they differ in tempo, what carries the sound, and captions. */
function format(id: FormatId, facts: Facts): FormatSummary {
  return {
    id,
    version: '1.0.0',
    nameKey: `formats.${id}.name`,
    descriptionKey: `formats.${id}.description`,
    minSeconds: 6,
    maxSeconds: 120,
    ...facts,
  };
}

/** In core's FORMAT_IDS order, as the templates service lists them. */
export const TEMPLATE_FORMATS: readonly FormatSummary[] = [
  format('vlog', { defaultBpm: 120, audio: 'music', captions: 'optional' }),
  format('dayInTheLife', { defaultBpm: 120, audio: 'music', captions: 'optional' }),
  format('talkingHead', { defaultBpm: 100, audio: 'voice', captions: 'required' }),
  format('podcastClip', { defaultBpm: 100, audio: 'voice', captions: 'required' }),
  format('ugcAd', { defaultBpm: 120, audio: 'music', captions: 'recommended' }),
  format('beforeAfter', { defaultBpm: 120, audio: 'music', captions: 'optional' }),
  format('tutorial', { defaultBpm: 100, audio: 'voice', captions: 'recommended' }),
  format('highlightReel', { defaultBpm: 128, audio: 'music', captions: 'optional' }),
];
