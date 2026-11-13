// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { StarterNeed, StarterSummary } from '@taalcut/core';
import { toSeconds, type StarterChoice } from '@taalcut/ui';
import { translateKey } from '../settings/model-messages';

/**
 * The starters' names under the keys the templates service names them by (`starters.<id>.name`, packages/templates'
 * STARTER_CATALOGUE), and the footage each needs (`starters.needs.<need>`): docs/onboarding.md section 9. Six are
 * offered in every language and two in each language of their own (P3-L2); a starter the window has no words for
 * falls back to a plain "Starter".
 */
const NAMES: readonly MessageDescriptor[] = [
  msg({ id: 'starters.weekend-trip.name', message: 'Weekend trip' }),
  msg({ id: 'starters.my-day.name', message: 'My day' }),
  msg({ id: 'starters.quick-tip.name', message: 'Quick tip to camera' }),
  msg({ id: 'starters.product-in-30-seconds.name', message: 'Product in 30 seconds' }),
  msg({ id: 'starters.glow-up.name', message: 'Glow-up' }),
  msg({ id: 'starters.best-moments.name', message: 'Best moments' }),
  msg({ id: 'starters.recipe-in-30-seconds.name', message: 'Recipe in 30 seconds' }),
  msg({ id: 'starters.podcast-moment.name', message: 'Podcast moment' }),
  msg({
    id: 'starters.festival-vlog.name',
    message: 'Festival vlog',
    comment: 'A starter template offered in Hindi only: a vlog of a festival such as Diwali or Holi.',
  }),
  msg({
    id: 'starters.wedding-highlights.name',
    message: 'Wedding highlights',
    comment: 'A starter template offered in Hindi only.',
  }),
  msg({
    id: 'starters.receta-rapida.name',
    message: 'Quick recipe',
    comment: 'A starter template offered in Spanish only. Its Spanish name is “Receta rápida”.',
  }),
  msg({
    id: 'starters.golazos.name',
    message: 'Great goals',
    comment:
      'A starter template offered in Spanish only: football highlights. Its Spanish name is “Golazos”.',
  }),
  msg({
    id: 'starters.role-de-fim-de-semana.name',
    message: 'Weekend outing',
    comment:
      'A starter template offered in Brazilian Portuguese only. Its Portuguese name is “Rolê de fim de semana”.',
  }),
  msg({
    id: 'starters.receita-rapida.name',
    message: 'Quick recipe',
    comment:
      'A starter template offered in Brazilian Portuguese only. Its Portuguese name is “Receita rápida”.',
  }),
];
const BY_KEY: ReadonlyMap<string, MessageDescriptor> = new Map(
  NAMES.flatMap((descriptor) => (descriptor.id ? [[descriptor.id, descriptor] as const] : [])),
);
const STARTER = msg`Starter`;

const NEEDS: Record<StarterNeed, MessageDescriptor> = {
  'many-clips': msg({ id: 'starters.needs.many-clips', message: 'Lots of short clips' }),
  'day-clips': msg({ id: 'starters.needs.day-clips', message: 'Clips across one day' }),
  'two-clips': msg({ id: 'starters.needs.two-clips', message: 'Two clips: before and after' }),
  talking: msg({ id: 'starters.needs.talking', message: 'One clip of you talking' }),
  steps: msg({ id: 'starters.needs.steps', message: 'A clip of each step' }),
  product: msg({ id: 'starters.needs.product', message: 'Clips of a product in use' }),
  conversation: msg({ id: 'starters.needs.conversation', message: 'One clip of a conversation' }),
};

export function starterName(i18n: I18n, nameKey: string): string {
  const known = BY_KEY.get(nameKey);
  return known ? i18n._(known) : translateKey(i18n, nameKey, STARTER);
}

/** A starter as the picker shows it: words in this language, its slots as placeholder blocks. */
export function starterChoice(i18n: I18n, summary: StarterSummary): StarterChoice {
  const { structure } = summary;
  return {
    kind: 'starter',
    starterId: summary.starterId,
    name: starterName(i18n, summary.nameKey),
    needs: i18n._(NEEDS[summary.needs]),
    slotCount: structure.slots.length,
    seconds: toSeconds(structure.duration),
    blocks: structure.slots.map((slot) => toSeconds(slot.duration)),
  };
}
