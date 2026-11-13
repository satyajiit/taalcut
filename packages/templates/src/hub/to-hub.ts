// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1 → Hub template v0 (P3-B12). Structure and, when asked, a look without assets. Frames, the reference
 * link, its words, its sound title and library ids stay on this Mac (D9). Every object is built from the hub
 * schema's fields (hub-document-parts.ts), so nothing rides along by spreading.
 */
import {
  err,
  HUB_FORMAT,
  HUB_FORMAT_VERSION,
  hubTemplateV0Schema,
  ok,
  type HubShareForm,
  type HubTemplateId,
  type HubTemplateV0,
  type Result,
  type Style,
  type Template,
  type TemplateSlot,
  type TextOverlay,
} from '@taalcut/core';
import {
  hubAppearance,
  hubBeatAnchor,
  hubBeatMap,
  hubBox,
  hubCanvas,
  hubPacing,
  hubSpeedRamp,
  hubStyle,
  hubTime,
  hubTransition,
} from './hub-document-parts';
import { hubInvalidFrom } from './hub-invalid';
import { placeholderFor, textMeasure } from './overlay-placeholders';

export interface HubTemplateMeta {
  readonly name: string;
  readonly hubId: HubTemplateId;
  readonly version: number;
  readonly provenance: { kind: 'hub'; hubId: HubTemplateId; version: number } | null;
}

function hubSlot(slot: TemplateSlot) {
  const { text, shotType, motion, subject, people, place, energy } = slot.intent;
  return {
    role: slot.role,
    name: slot.name,
    start: hubTime(slot.start),
    duration: hubTime(slot.duration),
    intent: { text, shotType, motion, subject, people, place, energy },
    beatAnchor: hubBeatAnchor(slot.beatAnchor),
    transitionIn: hubTransition(slot.transitionIn),
    speedRamp: hubSpeedRamp(slot.speedRamp),
  };
}

/** A role's placeholder and how long the words were, never the words. */
function hubOverlay(overlay: TextOverlay, slotIndex: ReadonlyMap<string, number>) {
  const counts = textMeasure(overlay.text);
  return {
    role: overlay.role,
    start: hubTime(overlay.start),
    duration: hubTime(overlay.duration),
    slotIndex: overlay.slotId === null ? null : (slotIndex.get(overlay.slotId) ?? null),
    box: hubBox(overlay.box),
    appearance: hubAppearance(overlay.appearance),
    styleKey: overlay.styleKey,
    reveal: overlay.reveal,
    language: overlay.language,
    placeholder: placeholderFor(overlay.role),
    words: counts.words,
    chars: counts.chars,
  };
}

/**
 * The document Share would send, before validation: the share check runs the hub's content rules on exactly
 * this. `meta.name` is the library name; the card's name is `form.name`.
 */
export function hubDraft(template: Template, meta: HubTemplateMeta, form: HubShareForm, style: Style | null) {
  const slotIndex = new Map<string, number>(template.slots.map((slot, index) => [slot.id, index]));
  const speech = template.audio.speech;
  return {
    format: HUB_FORMAT,
    formatVersion: HUB_FORMAT_VERSION,
    licence: 'CC0-1.0' as const,
    id: meta.hubId,
    version: meta.version,
    name: form.name,
    description: form.description,
    handle: form.handle,
    language: form.language,
    tags: [...form.tags],
    formatId: template.origin.kind === 'format' ? template.origin.formatId : null,
    trendFreshness: null,
    forkedFrom: meta.provenance ? { id: meta.provenance.hubId, version: meta.provenance.version } : null,
    structure: {
      canvas: hubCanvas(template.canvas),
      duration: hubTime(template.duration),
      slots: template.slots.map(hubSlot),
      beatMap: hubBeatMap(template.beatMap),
      text: template.text.map((overlay) => hubOverlay(overlay, slotIndex)),
      audio: {
        kind: template.audio.kind,
        loudnessLufs: template.audio.loudnessLufs,
        speechCoverage: speech?.coverage ?? null,
        speechLanguage: speech?.language ?? null,
      },
      pacing: hubPacing(template.pacing),
    },
    style: form.includeStyle && style ? hubStyle(style) : null,
  };
}

/** The validated document Share would send, or `hub.invalid` with its schema problems. */
export function toHubTemplate(
  template: Template,
  meta: HubTemplateMeta,
  form: HubShareForm,
  style: Style | null,
): Result<HubTemplateV0> {
  const parsed = hubTemplateV0Schema.safeParse(hubDraft(template, meta, form, style));
  return parsed.success ? ok(parsed.data) : err(hubInvalidFrom(parsed.error));
}
