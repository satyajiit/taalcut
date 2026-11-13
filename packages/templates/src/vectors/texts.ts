// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words the template index embeds (LRN1-TPL), built from the template's own structure: no model writes them.
 *
 * - A slot's intent: `slotIntentText`, the words casting embeds for the slot (its sentence, else its labels). Casting
 *   reads it from here, so the stored vector is the one casting would make.
 * - A template's document: its name and tags, what each slot shows, its on-screen text, its sound and its pacing in
 *   words ("fast cuts", "on the beat"), so a search for "fast travel reel with text" finds it by meaning.
 *
 * Names, overlays and intents can echo a reference's words: they are embedded as data and never reach a prompt from
 * here.
 */
import { RationalTime, type REFERENCE_PLATFORMS, type Template, type TemplateSlot } from '@taalcut/core';

/** The embedder contract's longest text. */
export const MAX_EMBEDDED_CHARS = 8192;

/** The words the intent is embedded from: its sentence, else its labels; null when it has none. */
export function slotIntentText(slot: TemplateSlot): string | null {
  const { intent } = slot;
  if (intent.source !== 'pending' && intent.text.trim().length > 0) return intent.text.trim();
  const words = [intent.shotType, intent.motion, intent.subject, intent.place].filter(
    (word): word is string => typeof word === 'string' && word.length > 0,
  );
  return words.length > 0 ? words.join(', ') : null;
}

/** What a document says about the template's lineage (the head itself has no name or tags). */
export interface TemplateDocumentMeta {
  readonly name: string;
  readonly tags: readonly string[];
}

/** Mean shot length in seconds, in the words a creator would search with. */
function cutWords(meanSeconds: number): string {
  if (meanSeconds < 0.6) return 'very fast cuts';
  if (meanSeconds < 1.2) return 'fast cuts';
  if (meanSeconds < 2.5) return 'steady cuts';
  return 'slow, long shots';
}

const seconds = (time: RationalTime) => Math.round(RationalTime.toSeconds(time) * 10) / 10;

/** Pacing, sound and movement in words, from the numbers the template already holds. */
export function pacingWords(template: Template): string[] {
  const { pacing, audio } = template;
  const words = [
    `${template.slots.length} shots over ${seconds(template.duration)} seconds`,
    `${cutWords(RationalTime.toSeconds(pacing.meanShot))}, ${seconds(pacing.meanShot)} s a shot`,
    `hook in the first ${seconds(pacing.hookEnd)} seconds`,
  ];
  if (pacing.cutsOnBeat !== null && pacing.cutsOnBeat >= 0.6) words.push('cut on the beat');
  if (template.beatMap?.bpm) words.push(`${Math.round(template.beatMap.bpm)} BPM`);
  if (audio.kind !== 'silent') words.push(audio.kind === 'voice' ? 'voice over' : `${audio.kind} sound`);
  if (template.slots.some((slot) => slot.speedRamp)) words.push('speed ramps');
  const transitions = [
    ...new Set(template.slots.flatMap((slot) => (slot.transitionIn ? [slot.transitionIn.kind] : []))),
  ];
  if (transitions.length > 0) words.push(`${transitions.join(' and ')} transitions`);
  if (template.text.length > 0) words.push('text on screen');
  return words;
}

const PLATFORM_WORDS: Readonly<Record<(typeof REFERENCE_PLATFORMS)[number], string>> = {
  reels: 'From an Instagram Reel',
  tiktok: 'From a TikTok video',
  shorts: 'From a YouTube Short',
  other: 'From a short video',
};

function originWords(template: Template): string {
  const { origin } = template;
  if (origin.kind === 'format') return `A ${origin.formatId} format plan`;
  if (origin.kind === 'manual') return 'Made by hand';
  return origin.platform ? PLATFORM_WORDS[origin.platform] : 'From a reference video';
}

/**
 * One text per template for document vectors: name, tags, origin, pacing, every slot's intent in order and the
 * on-screen text, cut to the embedder's limit (overlays go first, then late slots).
 */
export function templateDocumentText(template: Template, meta: TemplateDocumentMeta): string {
  const head = [
    meta.name.trim(),
    meta.tags.length > 0 ? `Tags: ${meta.tags.join(', ')}` : null,
    originWords(template),
    pacingWords(template).join('; '),
  ].filter((line): line is string => line !== null && line.length > 0);
  const shots = template.slots.flatMap((slot, index) => {
    const text = slotIntentText(slot);
    return text ? [`${index + 1}. ${slot.role}: ${text}`] : [];
  });
  const overlays = template.text.map((overlay) => overlay.text.trim()).filter((text) => text.length > 0);
  const lines = [...head, shots.length > 0 ? `Shots: ${shots.join('; ')}` : null];
  if (overlays.length > 0) lines.push(`On screen: ${overlays.join(' / ')}`);
  return lines
    .filter((line): line is string => line !== null)
    .join('\n')
    .slice(0, MAX_EMBEDDED_CHARS);
}
