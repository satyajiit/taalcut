// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the `sfx-bank` catalogue says about each earshot bank sound beyond upstream's own row (EAR1-D1, D22): its
 * Taalcut id, its family among core's four `SFX_CATEGORIES`, its bank source, licence, credit and provenance. Pure
 * data and lookups, so the refusal rules are testable without a render.
 *
 * Families: the planner puts a whoosh's apex on a whip or slide, a riser's into a zoom, an impact on a zoom, flash
 * or glitch, and a subtle hit on a hard cut. A category joins the family whose cut it serves:
 * - whoosh: the passes (whoosh_fast, whoosh_big, pro_whoosh_big, swish, swipe) and the tonal sweeps across a cut
 *   (pro_zip);
 * - riser: the builds into a cut (riser, pro_riser) and the reverse swells that peak on it (reverse_swell);
 * - impact: the weight on a cut (impact, pro_impact, cut_hit, sub_drop, pro_sub_drop), the energy falling away
 *   from it (downlifter), composite stings (logo_sting, pro_logo_sting) and glitches (glitch, pro_glitch);
 * - hit: every short touch, tick, pop, key, bell and note (the UI and tonal categories, pluck, shimmer);
 * - fit/<role>/<name>: by its role, whoosh.* a whoosh, every other role a hit.
 */

export const UPSTREAM = {
  repository: 'https://github.com/Leonxlnx/earshot',
  commit: 'ff41f0788ae56896fd59879ab03858d223c06a53',
};

/** core SFX_CATEGORIES, in its order; packages/audio/test/sfx-bank-build.test.ts checks they agree. */
export const FAMILIES = ['whoosh', 'riser', 'impact', 'hit'];

const BY_FAMILY = {
  whoosh: ['whoosh_fast', 'whoosh_big', 'pro_whoosh_big', 'swish', 'swipe', 'pro_zip'],
  riser: ['riser', 'pro_riser', 'reverse_swell'],
  impact: [
    'impact',
    'pro_impact',
    'cut_hit',
    'sub_drop',
    'pro_sub_drop',
    'downlifter',
    'logo_sting',
    'pro_logo_sting',
    'glitch',
    'pro_glitch',
  ],
  hit: [
    'click',
    'pro_click',
    'hover_tick',
    'pro_hover_tick',
    'tap',
    'pro_tap',
    'toggle',
    'pop',
    'pro_pop',
    'pro_pop_in',
    'notify',
    'pro_notify',
    'shimmer',
    'pro_shimmer',
    'typing_key',
    'pro_typing_key',
    'pro_typing_run',
    'pluck',
    'ui_pop',
    'knock',
    'mallet',
    'drip',
    'shutter',
  ],
};
export const FAMILY_OF = Object.fromEntries(
  Object.entries(BY_FAMILY).flatMap(([family, categories]) => categories.map((c) => [c, family])),
);

/**
 * The bank files earshot ships, by `sfx list`'s bank file: each one's licence and what to say about where its
 * sounds come from. A sound from any other file has no licence here and the build refuses it.
 *
 * Every sound is made by earshot's code (D22), so every render is MIT, earshot's licence. A fitted sound is no
 * exception: earshot renders it from a model in fit.json (`earshot.forge.fit.render`: modes, partials, band
 * envelopes) whose parameters were measured from a CC0 1.0 recording; no sample of the recording is part of it. The
 * recording is credited (`credit`, NOTICE.txt, CREDITS_FIT.md) as a credit, not as the sound's licence.
 */
export const SOURCES = {
  forge_v2: {
    licence: 'MIT',
    provenance: "Rendered from earshot's forge v2 recipe code (MIT); no recording used.",
  },
  forge04: {
    licence: 'MIT',
    provenance:
      "Rendered from earshot 0.4's recipe code (MIT); tuned toward aggregate measurements of private licensed clips; no audio used.",
  },
  pluck: {
    licence: 'MIT',
    provenance: "A tuned kalimba voice rendered from earshot's recipe code (MIT); no recording used.",
  },
  fit: {
    licence: 'MIT',
    provenance:
      "Rendered by earshot's code from a fitted model in fit.json (MIT): modes, partials and band envelopes measured from a CC0 1.0 recording, credited; no samples of the recording ship.",
  },
};

const bankFileUrl = (file) =>
  `${UPSTREAM.repository}/blob/${UPSTREAM.commit}/earshot/forge/bank/${file}.json`;
const FREE = /^(cc0|cc0 1\.0|public domain)$/i;

/** 'fit/land.light/fingertip_book' → 'fit/land_light_fingertip_book': core's sfxBankSoundIdSchema, one slash. */
export function taalcutId(upstreamId) {
  const parts = upstreamId.split('/');
  if (parts.length === 2) return upstreamId;
  if (parts.length === 3 && parts[0] === 'fit') return `fit/${parts[1].replaceAll('.', '_')}_${parts[2]}`;
  throw new Error(`${upstreamId}: not a bank id`);
}

const words = (s) => s.replaceAll(/[_./]+/g, ' ').trim();
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short English title for the library: 'Whoosh fast, crisp'; a fit names its recording. */
export function titleOf(row) {
  if (row.category === 'fit' && row.source?.title)
    return `${capital(words(row.member))} (fitted from "${row.source.title}")`.slice(0, 120);
  return `${capital(words(row.category))}, ${words(row.member)}`.slice(0, 120);
}

export function familyOf(row) {
  if (row.category === 'fit') return row.member.startsWith('whoosh') ? 'whoosh' : 'hit';
  return FAMILY_OF[row.category] ?? null;
}

/**
 * A row's licence, where to check it (its bank file at the pinned commit, fit.json for a fitted sound), its credit
 * (a fitted sound's CC0 recording, with its url) and provenance; `problems` lists what is missing (no licence, no
 * source, a recording that isn't CC0), which makes the build refuse the item.
 */
export function licensing(row) {
  const source = SOURCES[row.bank_file];
  const problems = [];
  if (!source) {
    problems.push(`bank file ${JSON.stringify(row.bank_file)} has no licence on record`);
    return { problems };
  }
  const known = {
    licence: source.licence,
    sourceUrl: bankFileUrl(row.bank_file),
    provenance: source.provenance,
  };
  if (row.bank_file !== 'fit') return { ...known, credit: null, problems };
  // The render is MIT only because the recording it was fitted to is free: anything but CC0 is refused.
  const s = row.source ?? {};
  if (!s.url || !/^https:\/\//.test(s.url)) problems.push('no source recording url');
  if (!s.license || !FREE.test(String(s.license).trim()))
    problems.push(`source licence ${JSON.stringify(s.license ?? null)} is not CC0`);
  if (!s.title || !s.author) problems.push('no source title or recordist');
  const credit =
    s.title && s.author ? `Fitted to the recording "${s.title}" by ${s.author} (CC0 1.0), ${s.url}` : null;
  return { ...known, credit, problems };
}
