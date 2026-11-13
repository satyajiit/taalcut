// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Composer's video effects catalogue: localised labels, descriptions, and
 * starter prompts for each `ChatEffectId` and `ChatEffectCategory` in `@taalcut/core`.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import {
  CHAT_EFFECT_CATEGORIES,
  CHAT_EFFECT_IDS,
  CHAT_EFFECT_SPECS,
  type ChatEffectCategory,
  type ChatEffectId,
} from '@taalcut/core';
import type { EffectGroup } from '@taalcut/ui';

export interface EffectCopy {
  readonly label: MessageDescriptor;
  readonly description: MessageDescriptor;
}

export const EFFECT_CATEGORY_LABELS: Readonly<Record<ChatEffectCategory, MessageDescriptor>> = {
  graphics: msg`Titles and graphics`,
  camera: msg`Camera and framing`,
  transitions: msg`Cuts and pacing`,
  captions: msg`Captions and sound`,
};

// UX4 (B14): each effect in a creator's words, not an editor's: what you see in the video, in one short line.
export const EFFECT_COPY: Readonly<Record<ChatEffectId, EffectCopy>> = {
  kineticTitle: {
    label: msg`Word-by-word title`,
    description: msg`The hook comes in a word at a time, clear of the app’s buttons`,
  },
  blurResolve: {
    label: msg`Focus-in title`,
    description: msg`The words start soft and come into focus`,
  },
  maskReveal: {
    label: msg`Wipe-in title`,
    description: msg`The words slide out from behind a clean edge`,
  },
  oversizeDrop: {
    label: msg`Big drop title`,
    description: msg`Large words drop in fast and land softly`,
  },
  flipReveal: {
    label: msg`Flip-in letters`,
    description: msg`Each letter flips into place, one after the next`,
  },
  wordSwap: {
    label: msg`Word swap`,
    description: msg`Key words change in place as they’re said`,
  },
  staccatoHit: {
    label: msg`Words on the beat`,
    description: msg`Words punch in on the drum hits`,
  },
  lowerThird: {
    label: msg`Name tag`,
    description: msg`A name or topic slides in low in the frame`,
  },
  callout: {
    label: msg`Callout`,
    description: msg`A circle or arrow draws in to point at a detail`,
  },
  animatedList: {
    label: msg`Checklist`,
    description: msg`Points appear one by one as you say them`,
  },
  counter: {
    label: msg`Number count-up`,
    description: msg`A number counts up to your figure`,
  },
  barChart: {
    label: msg`Bar chart`,
    description: msg`Bars grow to compare your numbers`,
  },
  callToAction: {
    label: msg`Follow card`,
    description: msg`A follow or subscribe card on the last beat`,
  },
  lockedOn: {
    label: msg`Stay on the face`,
    description: msg`The tall frame follows the speaker as they move`,
  },
  punchIn: {
    label: msg`Punch-in`,
    description: msg`A small push in on the hook and the key lines`,
  },
  zoomThrough: {
    label: msg`Zoom through the cut`,
    description: msg`The zoom carries across the cut into the next shot`,
  },
  blurBackdrop: {
    label: msg`Blurred backdrop`,
    description: msg`Wide footage fills the tall frame over a soft blur of itself`,
  },
  kenBurns: {
    label: msg`Slow drift`,
    description: msg`A slow pan and zoom across photos and cutaways`,
  },
  oneTakeFlow: {
    label: msg`One-take feel`,
    description: msg`Shots flow into each other like one long take`,
  },
  rhythmContrast: {
    label: msg`Fast, then a pause`,
    description: msg`Quick cuts, then a calm moment before the payoff`,
  },
  whipPan: {
    label: msg`Whip pan`,
    description: msg`A fast blur from one shot into the next, with a whoosh`,
  },
  flashCut: {
    label: msg`Cuts on the beat`,
    description: msg`Cuts land on the music’s beats, with a punch`,
  },
  zoomCut: {
    label: msg`Zoom cut`,
    description: msg`Pauses trimmed, with a small zoom at each cut`,
  },
  slideFlow: {
    label: msg`Slide across`,
    description: msg`Every cut slides the same way`,
  },
  popCaptions: {
    label: msg`Pop captions`,
    description: msg`Bold captions, each word lighting up as it’s said`,
  },
  boxCaptions: {
    label: msg`Boxed captions`,
    description: msg`Captions on a solid box, easy to read on any shot`,
  },
  cutHits: {
    label: msg`Whooshes and hits`,
    description: msg`Sound on the cuts: whooshes, rises and hits`,
  },
};

export function effectLabel(i18n: I18n, effectId: ChatEffectId): string {
  return i18n._(EFFECT_COPY[effectId].label);
}

export function buildEffectGroups(i18n: I18n): EffectGroup[] {
  return CHAT_EFFECT_CATEGORIES.map((category) => ({
    id: category,
    label: i18n._(EFFECT_CATEGORY_LABELS[category]),
    items: CHAT_EFFECT_IDS.filter((id) => CHAT_EFFECT_SPECS[id].category === category).map((id) => ({
      id,
      label: i18n._(EFFECT_COPY[id].label),
      description: i18n._(EFFECT_COPY[id].description),
    })),
  }));
}

export function starterPromptForEffects(i18n: I18n, effectIds: readonly ChatEffectId[]): string {
  if (effectIds.length === 0) return '';
  const names = effectIds.map((id) => effectLabel(i18n, id)).join(', ');
  return i18n._(msg`Apply effects: ${names}`);
}
