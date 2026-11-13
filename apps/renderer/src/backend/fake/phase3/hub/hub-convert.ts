// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1 ↔ hub template v0 for the fake hub, as @taalcut/templates' to-hub.ts, from-hub.ts and share-check.ts
 * do it: Share builds every object from the hub schema's own fields (nothing spread from the Template rides
 * along), keeps each overlay's placeholder and how long its words were, never the words; a fork makes new ids, a
 * manual origin, user intents and placeholder text, and must pass core's templateSchema.
 */
import {
  err,
  HUB_FORMAT,
  HUB_FORMAT_VERSION,
  HUB_ROLE_PLACEHOLDERS,
  HubInvalid,
  hubContentProblems,
  hubTemplateV0Schema,
  MAX_HUB_PROBLEMS,
  newId,
  ok,
  templateSchema,
  type HubProblem,
  type HubShareForm,
  type HubTemplateId,
  type HubTemplateV0,
  type RationalTime,
  type Result,
  type ShareCheck,
  type TaalcutError,
  type Template,
  type TemplateId,
} from '@taalcut/core';
import type { z } from 'zod';

const time = (at: RationalTime) => ({ value: at.value, rate: { num: at.rate.num, den: at.rate.den } });

/** hub.invalid with its problems in `detail` (paths and rules, never values), as hub-invalid.ts writes it. */
export function hubInvalid(problems: readonly HubProblem[]): TaalcutError {
  return HubInvalid(
    { problems: problems.length },
    { detail: JSON.stringify(problems.slice(0, MAX_HUB_PROBLEMS)) },
  );
}

const schemaProblems = (error: z.ZodError): HubProblem[] =>
  error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), rule: 'schema' }));

export interface DraftMeta {
  readonly hubId: HubTemplateId;
  readonly version: number;
  readonly forkedFrom: { readonly id: HubTemplateId; readonly version: number } | null;
}

/** A placeholder's measure: words 1–200 and characters 1–500, as the hub schema allows. */
function measure(text: string) {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return { words: Math.max(1, Math.min(200, words)), chars: Math.max(1, Math.min(500, text.length)) };
}

/**
 * A template's structure as the hub schema has it (to-hub.ts): frames, the reel's link, words and sound stay
 * here. Share's draft and a `.taalcut-template` file both carry it.
 */
export function hubStructure(template: Template) {
  const slotIndex = new Map<string, number>(template.slots.map((slot, index) => [slot.id, index]));
  const { pacing, beatMap } = template;
  return {
    canvas: {
      width: template.canvas.width,
      height: template.canvas.height,
      rate: { num: template.canvas.rate.num, den: template.canvas.rate.den },
    },
    duration: time(template.duration),
    slots: template.slots.map((slot) => {
      const { text, shotType, motion, subject, people, place, energy } = slot.intent;
      const transition = slot.transitionIn;
      const ramp = slot.speedRamp;
      return {
        role: slot.role,
        name: slot.name,
        start: time(slot.start),
        duration: time(slot.duration),
        intent: { text, shotType, motion, subject, people, place, energy },
        beatAnchor: slot.beatAnchor
          ? { beatIndex: slot.beatAnchor.beatIndex, offset: time(slot.beatAnchor.offset) }
          : null,
        transitionIn: transition
          ? {
              kind: transition.kind,
              before: time(transition.before),
              after: time(transition.after),
              direction: transition.direction,
              confidence: transition.confidence,
            }
          : null,
        speedRamp: ramp
          ? {
              points: ramp.points.map((point) => ({ at: time(point.at), speed: point.speed })),
              curve: ramp.curve,
            }
          : null,
      };
    }),
    beatMap: beatMap
      ? {
          rate: { num: beatMap.rate.num, den: beatMap.rate.den },
          beats: beatMap.beats.map(time),
          downbeats: [...beatMap.downbeats],
          bpm: beatMap.bpm,
          beatsPerBar: beatMap.beatsPerBar,
          confidence: beatMap.confidence,
          source: beatMap.source,
        }
      : null,
    text: template.text.map((overlay) => ({
      role: overlay.role,
      start: time(overlay.start),
      duration: time(overlay.duration),
      slotIndex: overlay.slotId === null ? null : (slotIndex.get(overlay.slotId) ?? null),
      box: { x: overlay.box.x, y: overlay.box.y, width: overlay.box.width, height: overlay.box.height },
      appearance: {
        size: overlay.appearance.size,
        align: overlay.appearance.align,
        case: overlay.appearance.case,
        background: overlay.appearance.background,
      },
      styleKey: overlay.styleKey,
      reveal: overlay.reveal,
      language: overlay.language,
      placeholder: HUB_ROLE_PLACEHOLDERS[overlay.role],
      ...measure(overlay.text),
    })),
    audio: {
      kind: template.audio.kind,
      loudnessLufs: template.audio.loudnessLufs,
      speechCoverage: template.audio.speech?.coverage ?? null,
      speechLanguage: template.audio.speech?.language ?? null,
    },
    pacing: {
      shotCount: pacing.shotCount,
      meanShot: time(pacing.meanShot),
      medianShot: time(pacing.medianShot),
      shortestShot: time(pacing.shortestShot),
      longestShot: time(pacing.longestShot),
      hookEnd: time(pacing.hookEnd),
      cutsOnBeat: pacing.cutsOnBeat,
    },
  };
}

/** The document Share would send, before validation (to-hub.ts hubDraft, without a look). */
export function hubDraft(template: Template, meta: DraftMeta, form: HubShareForm) {
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
    forkedFrom: meta.forkedFrom ? { id: meta.forkedFrom.id, version: meta.forkedFrom.version } : null,
    structure: hubStructure(template),
    style: null,
  };
}

/** A local template from a hub document (from-hub.ts): new ids, manual origin, placeholder text. */
export function fromHubTemplate(doc: HubTemplateV0, templateId: TemplateId, now: number): Result<Template> {
  const slots = doc.structure.slots.map((slot) => ({
    ...slot,
    id: newId<'TemplateSlot'>(),
    intent: { ...slot.intent, source: 'user' as const },
    cut: { method: 'user' as const, confidence: 1 },
    approved: false,
    frame: null,
  }));
  const audio = doc.structure.audio;
  const needsSpeech =
    audio.kind === 'voice' || audio.speechCoverage !== null || audio.speechLanguage !== null;
  const parsed = templateSchema.safeParse({
    schemaVersion: 1,
    id: templateId,
    version: 1,
    parentVersion: null,
    createdAt: now,
    origin: { kind: 'manual' },
    canvas: doc.structure.canvas,
    duration: doc.structure.duration,
    slots,
    beatMap: doc.structure.beatMap,
    text: doc.structure.text.map((overlay) => ({
      id: newId<'TextOverlay'>(),
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
  });
  return parsed.success ? ok(parsed.data) : err(hubInvalid(schemaProblems(parsed.error)));
}

const SLOT_PATH = /^structure\.slots\.(\d+)(?:\.|$)/;

function locate(problem: HubProblem): ShareCheck['problems'][number] {
  const match = SLOT_PATH.exec(problem.path);
  const field =
    problem.path
      .split('.')
      .filter((part) => part.length > 0)
      .at(-1) ?? 'document';
  return {
    path: problem.path,
    rule: problem.rule,
    slotIndex: match ? Number(match[1]) : null,
    field: field.slice(0, 40),
  };
}

/** share-check.ts: the document, core's hubContentProblems on it, and a round trip through Template v1. */
export function shareCheckOf(
  template: Template,
  meta: DraftMeta,
  form: HubShareForm,
  now: number,
): ShareCheck {
  const draft = hubDraft(template, meta, form);
  const problems = hubContentProblems(draft);
  const parsed = hubTemplateV0Schema.safeParse(draft);
  if (!parsed.success) return { document: null, problems: problems.map(locate) };
  if (!fromHubTemplate(parsed.data, template.id, now).ok) problems.push({ path: '', rule: 'schema' });
  return { document: parsed.data, problems: problems.slice(0, MAX_HUB_PROBLEMS).map(locate) };
}
