// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hub template v0 → Template v1 (P3-B12). New ids, manual origin, user intents,
 * placeholder overlay text, no contact sheet. A document that breaks a Template
 * invariant is `hub.invalid` and cannot be forked.
 */
import {
  err,
  ok,
  templateSchema,
  type HubTemplateV0,
  type Result,
  type SlotId,
  type Template,
  type TemplateId,
  type TextOverlayId,
} from '@taalcut/core';
import { hubInvalidFrom } from './hub-invalid';

export interface HubIds {
  template(): TemplateId;
  slot(): SlotId;
  overlay(): TextOverlayId;
}

/** A local template from a hub document. Ids come only from `ids`. */
export function fromHubTemplate(doc: HubTemplateV0, ids: HubIds, now: number): Result<Template> {
  const slots = doc.structure.slots.map((slot) => ({
    id: ids.slot(),
    name: slot.name,
    role: slot.role,
    start: slot.start,
    duration: slot.duration,
    intent: { ...slot.intent, source: 'user' as const },
    beatAnchor: slot.beatAnchor,
    transitionIn: slot.transitionIn,
    speedRamp: slot.speedRamp,
    cut: { method: 'user' as const, confidence: 1 },
    approved: false,
    frame: null,
  }));
  const audio = doc.structure.audio;
  const needsSpeech =
    audio.kind === 'voice' || audio.speechCoverage !== null || audio.speechLanguage !== null;
  const draft = {
    schemaVersion: 1 as const,
    id: ids.template(),
    version: 1,
    parentVersion: null,
    createdAt: now,
    origin: { kind: 'manual' as const },
    canvas: doc.structure.canvas,
    duration: doc.structure.duration,
    slots,
    beatMap: doc.structure.beatMap,
    text: doc.structure.text.map((overlay) => ({
      id: ids.overlay(),
      text: overlay.placeholder,
      role: overlay.role,
      start: overlay.start,
      duration: overlay.duration,
      slotId: overlay.slotIndex === null ? null : (slots[overlay.slotIndex]?.id ?? null),
      box: overlay.box,
      appearance: overlay.appearance,
      styleKey: overlay.styleKey,
      reveal: overlay.reveal,
      language: overlay.language,
      confidence: 1,
    })),
    audio: {
      kind: audio.kind,
      loudnessLufs: audio.loudnessLufs,
      sound: null,
      speech: needsSpeech
        ? { language: audio.speechLanguage, coverage: audio.speechCoverage ?? 0, segments: [] }
        : null,
      waveform: null,
    },
    pacing: doc.structure.pacing,
    styleId: null,
    contactSheet: null,
    language: doc.language,
  };
  const parsed = templateSchema.safeParse(draft);
  return parsed.success ? ok(parsed.data) : err(hubInvalidFrom(parsed.error));
}
