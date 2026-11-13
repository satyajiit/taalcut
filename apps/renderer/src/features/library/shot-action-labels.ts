// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words for what people in a clip are doing (LIB1-FIND). Core's forty fixed actions (SHOT_ACTIONS) are the
 * describer's own words in English; each has a translation here. A free one the model needed ("kneading dough") is
 * its words, shown as written and never translated.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ShotAction } from '@taalcut/core';

export const ACTION_LABELS: Readonly<Record<ShotAction, MessageDescriptor>> = {
  dancing: msg({ message: 'Dancing', context: 'what people in a clip are doing' }),
  walking: msg({ message: 'Walking', context: 'what people in a clip are doing' }),
  running: msg({ message: 'Running', context: 'what people in a clip are doing' }),
  jumping: msg({ message: 'Jumping', context: 'what people in a clip are doing' }),
  cycling: msg({ message: 'Cycling', context: 'what people in a clip are doing' }),
  swimming: msg({ message: 'Swimming', context: 'what people in a clip are doing' }),
  surfing: msg({ message: 'Surfing', context: 'what people in a clip are doing' }),
  skateboarding: msg({ message: 'Skateboarding', context: 'what people in a clip are doing' }),
  climbing: msg({ message: 'Climbing', context: 'what people in a clip are doing' }),
  hiking: msg({ message: 'Hiking', context: 'what people in a clip are doing' }),
  paddling: msg({ message: 'Paddling', context: 'what people in a clip are doing' }),
  riding: msg({ message: 'Riding', context: 'what people in a clip are doing' }),
  driving: msg({ message: 'Driving', context: 'what people in a clip are doing' }),
  exercising: msg({ message: 'Exercising', context: 'what people in a clip are doing' }),
  'playing sport': msg({ message: 'Playing sport', context: 'what people in a clip are doing' }),
  talking: msg({ message: 'Talking', context: 'what people in a clip are doing' }),
  singing: msg({ message: 'Singing', context: 'what people in a clip are doing' }),
  laughing: msg({ message: 'Laughing', context: 'what people in a clip are doing' }),
  eating: msg({ message: 'Eating', context: 'what people in a clip are doing' }),
  drinking: msg({ message: 'Drinking', context: 'what people in a clip are doing' }),
  cooking: msg({ message: 'Cooking', context: 'what people in a clip are doing' }),
  pouring: msg({ message: 'Pouring', context: 'what people in a clip are doing' }),
  chopping: msg({ message: 'Chopping', context: 'what people in a clip are doing' }),
  reading: msg({ message: 'Reading', context: 'what people in a clip are doing' }),
  writing: msg({ message: 'Writing', context: 'what people in a clip are doing' }),
  painting: msg({ message: 'Painting', context: 'what people in a clip are doing' }),
  'playing music': msg({ message: 'Playing music', context: 'what people in a clip are doing' }),
  playing: msg({ message: 'Playing', context: 'what people in a clip are doing' }),
  clapping: msg({ message: 'Clapping', context: 'what people in a clip are doing' }),
  waving: msg({ message: 'Waving', context: 'what people in a clip are doing' }),
  hugging: msg({ message: 'Hugging', context: 'what people in a clip are doing' }),
  posing: msg({ message: 'Posing', context: 'what people in a clip are doing' }),
  'taking a selfie': msg({ message: 'Taking a selfie', context: 'what people in a clip are doing' }),
  filming: msg({ message: 'Filming', context: 'what people in a clip are doing' }),
  shopping: msg({ message: 'Shopping', context: 'what people in a clip are doing' }),
  praying: msg({ message: 'Praying', context: 'what people in a clip are doing' }),
  celebrating: msg({ message: 'Celebrating', context: 'what people in a clip are doing' }),
  sleeping: msg({ message: 'Sleeping', context: 'what people in a clip are doing' }),
  working: msg({ message: 'Working', context: 'what people in a clip are doing' }),
  performing: msg({ message: 'Performing', context: 'what people in a clip are doing' }),
};

export interface ActionWords {
  readonly label: string;
  /** A free action is the model's words: shown as written, marked translate="no". */
  readonly raw: boolean;
}

/** An action in the person's language: a fixed one translated, a free one as the model wrote it. */
export function actionWords(i18n: I18n, action: string): ActionWords {
  const fixed = Object.hasOwn(ACTION_LABELS, action) ? ACTION_LABELS[action as ShotAction] : undefined;
  return fixed ? { label: i18n._(fixed), raw: false } : { label: action, raw: true };
}
