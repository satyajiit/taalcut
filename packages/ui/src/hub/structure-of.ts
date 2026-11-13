// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the StructurePreview (U6) draws, from a hub template's structure, a Template, or a hub index row's slot
 * strip: slots, beats and text boxes as seconds. Pure code on core's types only (the kit imports no runtime from
 * core), so a starter, a format, a fork and a hub row preview the same way. Never a frame, a sheet or a URL: the
 * shapes carry none.
 */
import type { HUB_ROLE_PLACEHOLDERS, HubIndexEntry, HubStructure, Template } from '@taalcut/core';
import { toSeconds } from '../templates/slot-words';

type HubSlot = HubStructure['slots'][number];
type HubOverlay = HubStructure['text'][number];
type TextRole = HubOverlay['role'];

/** core's HUB_ROLE_PLACEHOLDERS, as a value here (types only from core); the type keeps the two in step. */
const PLACEHOLDERS: typeof HUB_ROLE_PLACEHOLDERS = {
  title: '{title}',
  label: '{label}',
  list: '{list}',
  caption: '{caption}',
  cta: '{cta}',
  other: '{other}',
};

/** A Template's structure as a hub file would carry it: no ids, no words on screen, no frames. */
export function structureOf(template: Template): HubStructure {
  const slotIndex = new Map(template.slots.map((slot, index) => [slot.id, index]));
  const speech = template.audio.speech;
  return {
    canvas: template.canvas,
    duration: template.duration,
    slots: template.slots.map((slot): HubSlot => {
      const { text, shotType, motion, subject, people, place, energy } = slot.intent;
      return {
        role: slot.role,
        name: slot.name,
        start: slot.start,
        duration: slot.duration,
        intent: { text, shotType, motion, subject, people, place, energy },
        beatAnchor: slot.beatAnchor,
        transitionIn: slot.transitionIn,
        speedRamp: slot.speedRamp,
      };
    }),
    beatMap: template.beatMap,
    text: template.text.map((overlay): HubOverlay => ({
      role: overlay.role,
      start: overlay.start,
      duration: overlay.duration,
      slotIndex: overlay.slotId === null ? null : (slotIndex.get(overlay.slotId) ?? null),
      box: overlay.box,
      appearance: overlay.appearance,
      styleKey: overlay.styleKey,
      reveal: overlay.reveal,
      language: overlay.language,
      placeholder: PLACEHOLDERS[overlay.role],
      words: Math.max(1, overlay.text.trim().split(/\s+/u).filter(Boolean).length),
      chars: Math.max(1, overlay.text.length),
    })),
    audio: {
      kind: template.audio.kind,
      loudnessLufs: template.audio.loudnessLufs,
      speechCoverage: speech?.coverage ?? null,
      speechLanguage: speech?.language ?? null,
    },
    pacing: template.pacing,
  };
}

/** A hub index row's strip: slot lengths in canvas frames, the length and the tempo, without the file. */
export type HubStrip = Pick<HubIndexEntry, 'slotStrip' | 'duration' | 'bpm'>;

export interface PreviewSlot {
  readonly index: number;
  readonly start: number;
  readonly duration: number;
  readonly role: HubSlot['role'] | null;
  readonly shotType: HubSlot['intent']['shotType'];
  readonly motion: HubSlot['intent']['motion'];
  /** The slot's intent in the author's words (user content); null for a strip. */
  readonly words: string | null;
  readonly name: string | null;
  /** How the slot comes in: a cut, or a 150 ms fade for a dissolve or a fade (U6: never anything more). */
  readonly enter: 'cut' | 'fade';
}

export interface PreviewOverlay {
  readonly role: TextRole;
  readonly start: number;
  readonly duration: number;
  readonly box: HubOverlay['box'];
  readonly chars: number;
}

export interface PreviewModel {
  readonly duration: number;
  readonly slots: readonly PreviewSlot[];
  /** Beat times, in seconds. */
  readonly beats: readonly number[];
  readonly overlays: readonly PreviewOverlay[];
  /** Every cut sits on a beat (the summary says "cuts on the beat"). */
  readonly onBeat: boolean;
}

export function previewOfStructure(structure: HubStructure): PreviewModel {
  const slots = structure.slots.map((slot, index): PreviewSlot => ({
    index,
    start: toSeconds(slot.start),
    duration: toSeconds(slot.duration),
    role: slot.role,
    shotType: slot.intent.shotType,
    motion: slot.intent.motion,
    words: slot.intent.text,
    name: slot.name,
    enter: slot.transitionIn?.kind === 'dissolve' || slot.transitionIn?.kind === 'fade' ? 'fade' : 'cut',
  }));
  return {
    duration: toSeconds(structure.duration),
    slots,
    beats: structure.beatMap ? structure.beatMap.beats.map(toSeconds) : [],
    overlays: structure.text.map((overlay) => ({
      role: overlay.role,
      start: toSeconds(overlay.start),
      duration: toSeconds(overlay.duration),
      box: overlay.box,
      chars: overlay.chars,
    })),
    onBeat:
      structure.pacing.cutsOnBeat !== null
        ? structure.pacing.cutsOnBeat >= 0.8
        : slots.length > 1 && structure.slots.slice(1).every((slot) => slot.beatAnchor !== null),
  };
}

export function previewOfStrip(strip: HubStrip): PreviewModel {
  const rate = strip.duration.rate;
  let start = 0;
  const slots = strip.slotStrip.map((frames, index): PreviewSlot => {
    const duration = toSeconds({ value: frames, rate });
    const slot = {
      index,
      start,
      duration,
      role: null,
      shotType: null,
      motion: null,
      words: null,
      name: null,
      enter: 'cut' as const,
    };
    start += duration;
    return slot;
  });
  const duration = toSeconds(strip.duration);
  const beat = strip.bpm ? 60 / strip.bpm : 0;
  const beats = beat > 0 ? Array.from({ length: Math.floor(duration / beat) + 1 }, (_, i) => i * beat) : [];
  const onBeat =
    beat > 0 &&
    slots.length > 1 &&
    slots.every((slot) => Math.abs(slot.start / beat - Math.round(slot.start / beat)) < 0.05);
  return { duration, slots, beats, overlays: [], onBeat };
}

/** The slot playing at `time` (the last one at or before it). */
export function slotAt(model: PreviewModel, time: number): number {
  let found = 0;
  for (const slot of model.slots) if (slot.start <= time + 1e-6) found = slot.index;
  return found;
}
