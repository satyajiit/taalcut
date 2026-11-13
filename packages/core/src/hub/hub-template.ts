// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hub template v0 (P3-B12, docs/template-hub.md section 2): the CC0 file the template hub stores and the app
 * forks. Structure only: slots, beats, pacing, where text goes and how long it is, and optionally a look without
 * any asset. Never frames, contact sheets, the reference's link, its words or its audio. Strict objects all the
 * way down (hub-parts.ts): an unknown key anywhere is refused, so nothing private rides along. Ids are plain ULID
 * strings and times plain `{ value, rate }`, so the schema converts to JSON Schema for the hub repository.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { HUB_ROLE_PLACEHOLDERS } from '../templates/placeholders';
import {
  AUDIO_KINDS,
  CAMERA_MOTIONS,
  FORMAT_IDS,
  languageTagSchema,
  SHOT_TYPES,
  SLOT_ROLES,
  styleKeySchema,
  TEXT_REVEALS,
  TEXT_ROLES,
} from '../templates/template-parts';
import {
  hubBeatAnchorSchema,
  hubBeatMapSchema,
  hubBoxSchema,
  hubCanvasSchema,
  hubIdSchema,
  hubPacingStatsSchema,
  hubSpeedRampSchema,
  hubStyleV0Schema,
  hubTextAppearanceSchema,
  hubTimeSchema,
  hubTransitionSchema,
} from './hub-parts';

export const HUB_FORMAT = 'taalcut.template';
export const HUB_FORMAT_VERSION = 0;
/** A template file on disk (template.import, files.saveTemplateAs), without the dot. */
export const TEMPLATE_FILE_EXTENSION = 'taalcut-template';
/** The serialised document's limit, in UTF-8 bytes. */
export const HUB_MAX_BYTES = 128 * 1024;
export const hubHandleSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,29}$/);
export const hubTagSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/);

const hubIntentSchema = z
  .object({
    text: z.string().min(1).max(500),
    shotType: z.enum(SHOT_TYPES).nullable(),
    motion: z.enum(CAMERA_MOTIONS).nullable(),
    subject: z.string().max(120).nullable(),
    people: z.int().min(0).max(50).nullable(),
    place: z.string().max(120).nullable(),
    energy: z.number().min(0).max(1),
  })
  .strict();

export const hubSlotSchema = z
  .object({
    role: z.enum(SLOT_ROLES),
    name: z.string().min(1).max(60).nullable(),
    start: hubTimeSchema,
    duration: hubTimeSchema,
    intent: hubIntentSchema,
    beatAnchor: hubBeatAnchorSchema.nullable(),
    transitionIn: hubTransitionSchema.nullable(),
    speedRamp: hubSpeedRampSchema.nullable(),
  })
  .strict();

export const HUB_PLACEHOLDER_VALUES = Object.values(HUB_ROLE_PLACEHOLDERS) as [
  (typeof HUB_ROLE_PLACEHOLDERS)[keyof typeof HUB_ROLE_PLACEHOLDERS],
  ...(typeof HUB_ROLE_PLACEHOLDERS)[keyof typeof HUB_ROLE_PLACEHOLDERS][],
];

export const hubOverlaySchema = z
  .object({
    role: z.enum(TEXT_ROLES),
    start: hubTimeSchema,
    duration: hubTimeSchema,
    slotIndex: z.int().min(0).max(199).nullable(),
    box: hubBoxSchema,
    appearance: hubTextAppearanceSchema,
    styleKey: styleKeySchema,
    reveal: z.enum(TEXT_REVEALS),
    language: languageTagSchema.nullable(),
    placeholder: z.enum(HUB_PLACEHOLDER_VALUES),
    /** How long the reference's text was, so a fill fits the box: words and characters, never the words. */
    words: z.int().min(1).max(200),
    chars: z.int().min(1).max(500),
  })
  .strict();

export const hubStructureSchema = z
  .object({
    canvas: hubCanvasSchema,
    duration: hubTimeSchema,
    slots: z.array(hubSlotSchema).min(1).max(200),
    beatMap: hubBeatMapSchema.nullable(),
    text: z.array(hubOverlaySchema).max(100),
    audio: z
      .object({
        kind: z.enum(AUDIO_KINDS),
        loudnessLufs: z.number().min(-70).max(5).nullable(),
        speechCoverage: z.number().min(0).max(1).nullable(),
        speechLanguage: languageTagSchema.nullable(),
      })
      .strict(),
    pacing: hubPacingStatsSchema,
  })
  .strict();
export type HubStructure = z.output<typeof hubStructureSchema>;

export const hubTemplateV0Schema = z
  .object({
    format: z.literal(HUB_FORMAT),
    formatVersion: z.literal(HUB_FORMAT_VERSION),
    licence: z.literal('CC0-1.0'),
    id: hubIdSchema.describe('HubTemplate id'),
    version: z.int().min(1),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(280),
    handle: hubHandleSchema,
    language: languageTagSchema.nullable(),
    tags: z.array(hubTagSchema).max(8),
    formatId: z.enum(FORMAT_IDS).nullable(),
    trendFreshness: z.iso.date().nullable(),
    forkedFrom: z
      .object({ id: hubIdSchema, version: z.int().min(1) })
      .strict()
      .nullable(),
    structure: hubStructureSchema,
    style: hubStyleV0Schema.nullable(),
  })
  .strict();
export type HubTemplateV0 = z.output<typeof hubTemplateV0Schema>;
