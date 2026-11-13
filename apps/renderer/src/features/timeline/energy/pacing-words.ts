// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Pacing tab's words (P3-V12): a band's pacing ("Cut every 2 beats"), what a screen reader hears for its
 * slider ("Energy 80%, cut every beat"), the plan in a line, and the refusals the curve can meet, in the user's
 * words (the error catalogue has no entries for the energy codes yet). Numbers through Intl, counts through plural.
 */
import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { TaalcutError } from '@taalcut/core';
import { errorMessage } from '@taalcut/ui';
import type { BeatsPerClip } from './energy-model';

/** "Cut every 2 beats", "Cut every beat", "Cut every half beat". */
export function pacingWords(i18n: I18n, beats: BeatsPerClip): string {
  if (beats === 0.5) return i18n._(msg`Cut every half beat`);
  return i18n._(msg`${plural(beats, { one: 'Cut every beat', other: 'Cut every # beats' })}`);
}

/** A narrow band's pacing: "2 beats", "1 beat", "½ beat". */
export function pacingShort(i18n: I18n, beats: BeatsPerClip): string {
  if (beats === 0.5) return i18n._(msg`½ beat`);
  return i18n._(msg`${plural(beats, { one: '# beat', other: '# beats' })}`);
}

/** The narrowest band's pacing: the number of beats alone ("2", "½"). */
export function pacingNumber(i18n: I18n, beats: BeatsPerClip): string {
  return beats === 0.5 ? '½' : i18n.number(beats);
}

/** The menu's choice: "Every 2 beats". */
export function beatsChoice(i18n: I18n, beats: BeatsPerClip): string {
  if (beats === 0.5) return i18n._(msg`Every half beat`);
  return i18n._(msg`${plural(beats, { one: 'Every beat', other: 'Every # beats' })}`);
}

/** The band's slider, in words: "Energy 80%, cut every beat". */
export function bandValueText(i18n: I18n, energy: number, beats: BeatsPerClip): string {
  const percent = i18n.number(energy, { style: 'percent', maximumFractionDigits: 0 });
  if (beats === 0.5) return i18n._(msg`Energy ${percent}, cut every half beat`);
  return i18n._(
    msg`Energy ${percent}, ${plural(beats, { one: 'cut every beat', other: 'cut every # beats' })}`,
  );
}

/** "Section 2 of 5". */
export function bandName(i18n: I18n, index: number, count: number): string {
  const at = i18n.number(index + 1);
  const of = i18n.number(count);
  return i18n._(msg`Section ${at} of ${of}`);
}

/** "4 shots will be picked again", or that only the cuts move. */
export function replanWords(i18n: I18n, picks: number, changed: number): string {
  if (changed === 0) return i18n._(msg`The cuts stay where they are`);
  if (picks === 0)
    return i18n._(
      msg`${plural(changed, { one: 'One cut moves; your shots stay', other: '# cuts move; your shots stay' })}`,
    );
  return i18n._(
    msg`${plural(picks, { one: 'One shot will be picked again', other: '# shots will be picked again' })}`,
  );
}

/** The template page's preview: "3 slots change. Nothing changes until you apply." */
export function slotsWords(i18n: I18n, changed: number): string {
  if (changed === 0) return i18n._(msg`The slots stay as they are`);
  return i18n._(
    msg`${plural(changed, { one: 'One slot changes. Nothing changes until you apply.', other: '# slots change. Nothing changes until you apply.' })}`,
  );
}

/** The curve's refusals, said plainly; anything else as the catalogue says it. */
export function energyErrorWords(i18n: I18n, error: TaalcutError): string {
  switch (error.code) {
    case 'templates.no_beat_map':
      return i18n._(msg`This video follows speech, not music beats`);
    case 'templates.energy_curve_invalid':
      return i18n._(msg`These sections don’t cover the whole video. Reset and try again.`);
    case 'timeline.template_not_found':
      return i18n._(msg`This video wasn’t cut to a template, so it has no sections to pace.`);
    case 'core.conflict':
      return i18n._(msg`The template changed since this plan. Check again.`);
    case 'timeline.clip_locked':
      return i18n._(msg`A shot you locked is in a changed section.`);
    case 'timeline.media_too_short':
      return i18n._(msg`A shot is too short for its new length. Try a slower pace there.`);
    default:
      return errorMessage(i18n, error);
  }
}
