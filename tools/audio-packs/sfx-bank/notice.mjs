// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `sfx-bank` component's NOTICE.txt (D22): what the sounds are, under which licence (MIT, every one: all are
 * made by earshot's code), and where they come from, with the CC0 recordings the fitted sounds were measured from
 * credited; written from the catalogue so the counts and credits are always the shipped ones.
 */

const count = (items, key) =>
  [...Map.groupBy(items, (item) => item[key])].map(([value, list]) => `${value} ${list.length}`).join(', ');

export function bankNotice(catalogue) {
  const { items, upstream, withheld } = catalogue;
  const credits = items
    .filter((item) => item.credit)
    .map((item) => `- ${item.id} (${item.upstreamId}): ${item.credit}`);
  return `${[
    `Taalcut SFX bank ${catalogue.packVersion}`,
    '',
    `The sound effects of earshot ${upstream.version} (${upstream.repository},`,
    `commit ${upstream.commit}, bank ${upstream.bank}),`,
    "rendered into takes by Taalcut's build (tools/audio-packs/sfx-bank). earshot is copyright (c) 2026 Leon Lin,",
    'MIT licence: LICENSE-earshot.txt.',
    '',
    `${items.length} sounds (by source: ${count(items, 'source')}; by licence: ${count(items, 'licence')}).`,
    '',
    "Every sound is code-made, licence MIT (earshot's): rendered by earshot's code (numpy and scipy signal",
    'processing) from its bank files at the commit above. No recording, and no sample of one, is part of any sound.',
    '',
    'Recipe sounds (forge_v2, forge04, pluck): rendered from earshot recipe code. The forge04 members (earshot 0.4)',
    'were tuned toward aggregate measurements (medians, ranges, CLAP similarity) of a private set of licensed',
    'reference clips; no audio of those clips was used or ships, and each member measures as an original (CLAP',
    'similarity at most 0.84 to any of them).',
    '',
    "Fitted sounds (fit): rendered by earshot's code from the models in its fit.json (MIT), which store the structure",
    'of a sound (modes, partials, band envelopes), not its samples. earshot measured those models from recordings on',
    'Freesound released under CC0 1.0. CC0 asks for no credit; the recordists are credited here and in',
    'CREDITS_FIT.md anyway, with thanks:',
    ...credits,
    '',
    withheld.length
      ? `Withheld: ${withheld.length} sounds whose every take fails earshot's model-free audit (${withheld.map((w) => w.upstreamId).join(', ')}).`
      : 'Withheld: none.',
  ].join('\n')}\n`;
}
