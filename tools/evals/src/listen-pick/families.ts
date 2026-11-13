// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The SFX bank's families for the listen-pick eval (EAR1-B2): earshot's own category rows (docs/SFX.md, "Categories",
 * at ff41f07), where upstream lists sibling categories in one row ("click, pro_click"), joined as one family. A sound
 * fitted from a CC0 recording (`fit/<role>/<name>`) counts by its role. 22 families over the bank's categories.
 */

export interface PickFamily {
  /** earshot categories in the family. */
  readonly categories: readonly string[];
  /** Fitted sounds' roles that belong to it. */
  readonly fitRoles: readonly string[];
  /** What upstream says the row is for (docs/SFX.md). */
  readonly doc: string;
}

export const PICK_FAMILIES = {
  click: {
    categories: ['click', 'pro_click'],
    fitRoles: ['click'],
    doc: 'cursor presses; bright designed UI ticks',
  },
  tick: {
    categories: ['hover_tick', 'pro_hover_tick'],
    fitRoles: ['tick'],
    doc: 'hover, rows passing, cursor blinks, counters',
  },
  tap: { categories: ['tap', 'pro_tap'], fitRoles: ['land.light'], doc: 'taps and touches on a surface' },
  toggle: { categories: ['toggle'], fitRoles: ['snap'], doc: 'switches and lock-ins (press + latch)' },
  pop: {
    categories: ['pop', 'pro_pop', 'pro_pop_in', 'ui_pop'],
    fitRoles: ['pop'],
    doc: 'bubble pops; tonal pops; an element popping in; soft rounded mid pops',
  },
  bell: {
    categories: ['notify', 'pro_notify'],
    fitRoles: ['bell'],
    doc: 'struck bell chimes; short clean dings',
  },
  shimmer: {
    categories: ['shimmer', 'pro_shimmer'],
    fitRoles: [],
    doc: 'chimes ringing out, granular sparkle',
  },
  whoosh: {
    categories: ['whoosh_fast', 'whoosh_big', 'pro_whoosh_big'],
    fitRoles: ['whoosh.short'],
    doc: 'fast passes; big air transitions; the designed low sub swell',
  },
  swish: {
    categories: ['swish', 'swipe'],
    fitRoles: [],
    doc: 'thin flicks and text slides; cloth and paper swipes',
  },
  riser: { categories: ['riser', 'pro_riser'], fitRoles: [], doc: 'builds into a cut' },
  downlifter: { categories: ['downlifter'], fitRoles: [], doc: 'energy falling away' },
  zip: { categories: ['pro_zip'], fitRoles: [], doc: 'tonal sweeps across a cut' },
  impact: {
    categories: ['impact', 'pro_impact', 'cut_hit'],
    fitRoles: ['hit'],
    doc: 'a cinematic hit; a designed gated sub impact; a short sub or punchy hit on a cut',
  },
  drop: {
    categories: ['sub_drop', 'pro_sub_drop'],
    fitRoles: [],
    doc: 'weight under a hit; a drop after the cut',
  },
  sting: {
    categories: ['logo_sting', 'pro_logo_sting'],
    fitRoles: [],
    doc: 'composite logo reveals; launch gestures onto a tone',
  },
  glitch: {
    categories: ['glitch', 'pro_glitch'],
    fitRoles: [],
    doc: 'glitch transitions; a designed stutter',
  },
  key: {
    categories: ['typing_key', 'pro_typing_key', 'pro_typing_run'],
    fitRoles: ['key', 'key.space'],
    doc: 'mechanical keys; designed key ticks; a whole run',
  },
  note: { categories: ['pluck', 'mallet'], fitRoles: [], doc: 'a kalimba tine; short gated mallet notes' },
  knock: { categories: ['knock'], fitRoles: [], doc: 'mid-band wood and plastic knocks' },
  drip: { categories: ['drip'], fitRoles: [], doc: 'water drops: a bubble whose pitch rises' },
  shutter: { categories: ['shutter'], fitRoles: [], doc: 'camera shutters' },
  swell: {
    categories: ['reverse_swell'],
    fitRoles: [],
    doc: 'reverse cymbals and swells that peak after a cut',
  },
} as const satisfies Record<string, PickFamily>;

export type PickFamilyName = keyof typeof PICK_FAMILIES;
export const PICK_FAMILY_NAMES = Object.keys(PICK_FAMILIES) as PickFamilyName[];

/**
 * A bank sound's family from its earshot category and upstream id (`fit/<role>/<name>`, or Taalcut's folded
 * `fit/<role_with_underscores>_<name>`); null when it belongs to none.
 */
export function familyOf(category: string, upstreamId: string): PickFamilyName | null {
  if (category === 'fit') {
    const role = fitRole(upstreamId);
    return (
      PICK_FAMILY_NAMES.find((name) => (PICK_FAMILIES[name].fitRoles as readonly string[]).includes(role)) ??
      null
    );
  }
  return (
    PICK_FAMILY_NAMES.find((name) =>
      (PICK_FAMILIES[name].categories as readonly string[]).includes(category),
    ) ?? null
  );
}

const FIT_ROLES = PICK_FAMILY_NAMES.flatMap((name) => PICK_FAMILIES[name].fitRoles as readonly string[]);

function fitRole(id: string): string {
  const parts = id.split('/');
  if (parts.length === 3) return parts[1] ?? '';
  const rest = parts[1] ?? '';
  // Folded ids: the longest known role whose underscored form starts the rest.
  const known = [...FIT_ROLES].sort((a, b) => b.length - a.length);
  return known.find((role) => rest.startsWith(`${role.replaceAll('.', '_')}_`)) ?? rest.split('_')[0] ?? '';
}
