// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A variant in words (P3-V3, U1): its label ("Original", "Variant 2"), what differs from the original ("New hook ·
 * Your own track · Bold captions", "40% different shots") and why fewer were made than asked.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type {
  CaptionPresetId,
  MusicChoice,
  VariantAxis,
  VariantDifference,
  VariantsShort,
} from '@taalcut/core';
import { createFormatters } from '#lib/format';
import { MUSIC_LABELS } from '../cards/export-labels';

const MUSIC: Readonly<Record<MusicChoice['path'], MessageDescriptor>> = {
  none: MUSIC_LABELS.none,
  platformSound: msg`No music in the file`,
  ownTrack: MUSIC_LABELS.ownTrack,
  referenceAudio: MUSIC_LABELS.referenceAudio,
  generated: MUSIC_LABELS.generated,
};

const CAPTIONS: Readonly<Record<CaptionPresetId, MessageDescriptor>> = {
  classic: msg`Classic captions`,
  bold: msg`Bold captions`,
  boxed: msg`Boxed captions`,
  karaoke: msg`Karaoke captions`,
  minimal: msg`Minimal captions`,
};

const SHORT: Readonly<Record<VariantAxis, MessageDescriptor>> = {
  hook: msg`your library ran out of different hooks`,
  music: msg`there weren’t enough different tracks`,
  captions: msg`there weren’t enough different caption looks`,
};

/** "Original" for the base (index null), else "Variant 1"…. */
export function variantLabel(i18n: I18n, index: number | null): string {
  if (index === null) return i18n._(msg`Original`);
  const n = i18n.number(index);
  return i18n._(msg`Variant ${n}`);
}

export interface DifferenceWords {
  /** The axes that changed, in the card's order: hook, music, captions. */
  readonly changes: readonly string[];
  /** "40% different shots"; null when every slot shows the same shot. */
  readonly shots: string | null;
}

export function differenceWords(i18n: I18n, difference: VariantDifference): DifferenceWords {
  const changes: string[] = [];
  if (difference.hookChanged) changes.push(i18n._(msg`New hook`));
  if (difference.music) changes.push(i18n._(MUSIC[difference.music.path]));
  if (difference.captionPreset) changes.push(i18n._(CAPTIONS[difference.captionPreset]));
  const share =
    difference.picksChanged > 0 ? createFormatters(i18n.locale).percent(difference.picksChanged) : null;
  return { changes, shots: share === null ? null : i18n._(msg`${share} different shots`) };
}

/** "Made 3 of 5: your library ran out of different hooks". */
export function shortLine(i18n: I18n, short: VariantsShort): string {
  const made = i18n.number(short.made);
  const asked = i18n.number(short.asked);
  const why = i18n._(SHORT[short.axis]);
  return i18n._(msg`Made ${made} of ${asked}: ${why}`);
}
