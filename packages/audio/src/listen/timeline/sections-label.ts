// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A section's one-line label (timeline `_section_label`), in English for the agent and logs, never shown as is: the
 * genre (a '?' under z 2.5), the instrument from z 1.5, the mood from 2.5 (weaker moods were wrong about 45% of the
 * time under effects), other sources from AST, else the ambience, and a voice when AST hears speech. Neighbours whose
 * labels share the genre and the other sources merge (sections.ts), so the label is also the merge key.
 */
import type { SoundTagCategory } from '@taalcut/core';

export interface SectionTag {
  readonly term: string;
  readonly category: SoundTagCategory;
  /** Within the vocabulary for this section's mean embedding (plain z of the cosines: a hint, not calibrated). */
  readonly z: number;
  readonly cosine: number;
}

export interface SectionPresence {
  readonly music: number;
  readonly speech: number;
  readonly silence: number;
}

export interface LabelInput {
  readonly genre: readonly SectionTag[];
  readonly mood: readonly SectionTag[];
  readonly instruments: readonly SectionTag[];
  readonly ambience: readonly SectionTag[];
  readonly voice: readonly SectionTag[];
  readonly lufs: number | null;
  readonly silent: boolean;
  readonly presence: SectionPresence | null;
  readonly audioSet: readonly { readonly label: string; readonly score: number }[] | null;
}

const Z_OK = 2.5;
const Z_WEAK = 1.5;
const AST_GENERIC = new Set([
  'Music',
  'Musical instrument',
  'Speech',
  'Silence',
  'Sound effect',
  'Inside, small room',
  'Outside, rural or natural',
  'Outside, urban or manmade',
  'Inside, large room or hall',
  'Animal',
]);

/** timeline._short: without a leading article. */
export function shortTerm(term: string): string {
  for (const article of ['a ', 'an ', 'the '])
    if (term.startsWith(article)) return term.slice(article.length);
  return term;
}

export function sectionLabel(s: LabelInput): string {
  if (s.silent) return 'digital silence';
  if (s.lufs === null || s.lufs < -55) return 'near silence';
  const parts: string[] = [];
  const [genre, mood, instrument, ambience, voice] = [
    s.genre[0],
    s.mood[0],
    s.instruments[0],
    s.ambience[0],
    s.voice[0],
  ];
  const music = s.presence ? s.presence.music >= 0.3 : (genre?.z ?? 0) >= (ambience?.z ?? 0);
  if (music && genre) {
    const bits = [shortTerm(genre.term) + (genre.z >= Z_OK ? '' : '?')];
    if (instrument && instrument.z >= Z_WEAK) bits.push(shortTerm(instrument.term));
    if (mood && mood.z >= Z_OK) bits.push(shortTerm(mood.term).replace(' music', ''));
    parts.push(bits.join(', '));
  }
  const extra = (s.audioSet ?? [])
    .filter((entry) => !AST_GENERIC.has(entry.label) && entry.score >= 0.08)
    .slice(0, 3)
    .map((entry) => entry.label.toLowerCase());
  if (extra.length > 0) parts.push(`also: ${extra.join(', ')} (AST)`);
  else if (ambience && ambience.z >= (music ? Z_OK : Z_WEAK)) parts.push(`amb: ${shortTerm(ambience.term)}`);
  if ((s.presence?.speech ?? 0) >= 0.3 || (!s.presence && (voice?.z ?? 0) >= Z_OK)) {
    parts.push(`voice: ${shortTerm(voice?.term ?? '')}`);
  }
  return parts.join(' | ') || 'unclear (no confident music / ambience / voice tag)';
}

/** The merge key: the genre (first comma part) and every other part. */
export function labelKey(label: string): string {
  const parts = label.split(' | ');
  return JSON.stringify([(parts[0] ?? '').split(',')[0], parts.slice(1)]);
}
