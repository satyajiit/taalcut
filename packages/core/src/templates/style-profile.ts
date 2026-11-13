// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style profiles (LRN1-STY): what a set of references has in common, aggregated without a model from the typed
 * structure of its templates by @taalcut/templates' `profileOf` (spike 09: the structure already exists, so nothing
 * is extracted by an LLM). A profile covers pacing, the hook (slot 0), the transition and speed-ramp mix, overlay
 * style, audio, form, and 1–3 exemplar templates (the medoids by slot-intent vectors in the template index).
 *
 * A source set is an Instagram Saved collection, a template folder, a tag, or the templates of the person's own
 * exports. The library stores one profile per set (StyleProfileStore), derived and rebuilt when the set's member
 * versions change. Numbers are rounded (seconds to the millisecond, shares to 3 places) so a rebuild of the same
 * set is byte-identical in canonical JSON.
 *
 * Text in a profile (`hook.textExamples`) is OCR of the references, and a summary's text is model output: both are
 * untrusted, shown as plain text and fenced wherever they reach a prompt.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { INSTAGRAM_COLLECTION_ID_REGEX } from './instagram-saved';
import { templateTagSchema } from './template-library';
import {
  AUDIO_KINDS,
  contactSheetSchema,
  SHOT_TYPES,
  TEXT_REVEALS,
  TEXT_ROLES,
  TRANSITION_KINDS,
} from './template-parts';
import { templateRefSchema } from './template-schema';

/** Bumped with any change to what profileOf computes or how it rounds; part of every stored profile's digest. */
export const STYLE_PROFILE_ALGORITHM = 'style-profile.v1';
/** The newest this many members are profiled (a Saved collection can hold thousands of reels). */
export const STYLE_PROFILE_MAX_MEMBERS = 500;
export const STYLE_PROFILE_MAX_EXEMPLARS = 3;

export const STYLE_SOURCE_KINDS = ['instagram-collection', 'folder', 'tag', 'my-exports'] as const;
export type StyleSourceKind = (typeof STYLE_SOURCE_KINDS)[number];

/**
 * A set of references. instagram-collection: the templates linked to its saved Reels (`all_saved`: every saved Reel);
 * folder and tag: the templates filed or tagged so; my-exports: the templates of timelines with a finished export.
 * Members are always the templates' heads, unarchived.
 */
export const styleSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('instagram-collection'),
    collectionId: z.string().trim().min(1).max(120).regex(INSTAGRAM_COLLECTION_ID_REGEX),
  }),
  z.object({ kind: z.literal('folder'), folderId: idSchema<'TemplateFolder'>() }),
  z.object({ kind: z.literal('tag'), tag: templateTagSchema }),
  z.object({ kind: z.literal('my-exports') }),
]);
export type StyleSource = z.output<typeof styleSourceSchema>;

/** The set as one string: the library's key and `library.changed`'s id. `<kind>:<ref>`, or `my-exports`. */
export function styleSourceKey(source: StyleSource): string {
  switch (source.kind) {
    case 'instagram-collection':
      return `instagram-collection:${source.collectionId}`;
    case 'folder':
      return `folder:${source.folderId}`;
    case 'tag':
      return `tag:${source.tag}`;
    case 'my-exports':
      return 'my-exports';
  }
}

/** The set a key names, or null when it isn't one (an unknown kind, a bad reference). */
export function parseStyleSourceKey(key: string): StyleSource | null {
  const colon = key.indexOf(':');
  const kind = colon < 0 ? key : key.slice(0, colon);
  const ref = colon < 0 ? undefined : key.slice(colon + 1);
  const candidate =
    kind === 'instagram-collection'
      ? { kind, collectionId: ref }
      : kind === 'folder'
        ? { kind, folderId: ref }
        : kind === 'tag'
          ? { kind, tag: ref }
          : kind === 'my-exports' && ref === undefined
            ? { kind }
            : null;
  const parsed = candidate ? styleSourceSchema.safeParse(candidate) : null;
  // A tag normalises (case, spaces): only the key it was made from is that set's key.
  return parsed?.success && styleSourceKey(parsed.data) === key ? parsed.data : null;
}

/** A spread of numbers: quartiles by linear interpolation between closest ranks (R type 7), over `n` values. */
export const styleBandSchema = z.object({
  n: z.int().min(1),
  q1: z.number(),
  median: z.number(),
  q3: z.number(),
});
export type StyleBand = z.output<typeof styleBandSchema>;

/** How often each value came up: count first (most first), then value; values never seen are left out. */
function tallyOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.array(z.object({ value: z.enum(values), count: z.int().min(1) })).max(values.length);
}

export const STYLE_SHOT_TYPES = [...SHOT_TYPES, 'unknown'] as const;
export const STYLE_TRANSITIONS = [...TRANSITION_KINDS, 'cut'] as const;
export const STYLE_RAMP_CURVES = ['linear', 'ease', 'hold'] as const;
/** Where a text box's centre sits, in thirds of the frame's height. */
export const STYLE_TEXT_POSITIONS = ['top', 'middle', 'bottom'] as const;
/** A text's cap height against the canvas height, in bands (@taalcut/templates' profile config sets the bounds). */
export const STYLE_TEXT_SIZES = ['small', 'medium', 'large'] as const;
export const STYLE_TEXT_CASES = ['upper', 'lower', 'mixed'] as const;
export const STYLE_TEXT_BACKGROUNDS = ['none', 'box', 'outline', 'shadow'] as const;
/** The canvas's shape, to the nearest common one within 2 %. */
export const STYLE_ASPECTS = ['9:16', '4:5', '1:1', '16:9', 'other'] as const;
/** Points in `audio.energy`: one per tenth of the length. */
export const STYLE_ENERGY_POINTS = 10;

export const styleProfileSchema = z.object({
  algorithm: z.literal(STYLE_PROFILE_ALGORITHM),
  /** Member templates profiled. */
  members: z.int().min(1).max(STYLE_PROFILE_MAX_MEMBERS),
  pacing: z.object({
    /** Every slot of every member, in seconds. The Reviewer's band: a render's median shot stays within q1..q3. */
    shot: styleBandSchema,
    /** Share of the cuts on a beat, over the members with a beat map; null when none has one. */
    cutsOnBeat: z.number().min(0).max(1).nullable(),
    withBeats: z.int().nonnegative(),
    /** Per member: its slots that start in the first 3 s. */
    shotsInFirst3s: styleBandSchema,
  }),
  hook: z.object({
    /** Slot 0's shot type per member ('unknown': the intent doesn't say). */
    shotType: tallyOf(STYLE_SHOT_TYPES),
    /** Slot 0's length per member, in seconds. */
    duration: styleBandSchema,
    /** Members whose first slot shows text. */
    withText: z.int().nonnegative(),
    /** The first text in slot 0, per member that has one. */
    reveal: tallyOf(TEXT_REVEALS),
    role: tallyOf(TEXT_ROLES),
    /** The exemplars' first hook texts as the references showed them (OCR): untrusted, plain text only. */
    textExamples: z.array(z.string().min(1).max(120)).max(STYLE_PROFILE_MAX_EXEMPLARS),
  }),
  mix: z.object({
    /** Every cut (slot 1 onward): its transition, 'cut' for none. Empty when no member has a second slot. */
    transitions: tallyOf(STYLE_TRANSITIONS),
    /** Slots of every member, and those with a speed ramp. */
    slots: z.int().min(1),
    speedRamps: z.int().nonnegative(),
    rampCurves: tallyOf(STYLE_RAMP_CURVES),
  }),
  overlays: z.object({
    /** Text overlays over every member, and the members with any. */
    count: z.int().nonnegative(),
    withText: z.int().nonnegative(),
    position: tallyOf(STYLE_TEXT_POSITIONS),
    size: tallyOf(STYLE_TEXT_SIZES),
    reveal: tallyOf(TEXT_REVEALS),
    case: tallyOf(STYLE_TEXT_CASES),
    background: tallyOf(STYLE_TEXT_BACKGROUNDS),
    /** Words in each line of each overlay; null without overlays. */
    wordsPerLine: styleBandSchema.nullable(),
  }),
  audio: z.object({
    kind: tallyOf(AUDIO_KINDS),
    /** Median integrated loudness (LUFS, one decimal) of the members with one; null when none has. */
    loudnessLufs: z.number().min(-70).max(5).nullable(),
    /**
     * The sound's shape: each member's waveform as the mean peak in each tenth of its length, scaled to its own
     * loudest tenth, then the median per tenth over the members with a waveform. Null when none has one.
     */
    energy: z.array(z.number().min(0).max(1)).length(STYLE_ENERGY_POINTS).nullable(),
  }),
  form: z.object({
    /** Length per member, in seconds. */
    length: styleBandSchema,
    aspect: tallyOf(STYLE_ASPECTS),
  }),
  /** 1–3 medoids by slot-intent vector distance, ties by id; empty until the template index has members' vectors. */
  exemplars: z.array(templateRefSchema).max(STYLE_PROFILE_MAX_EXEMPLARS),
  /** Members whose slot vectors the exemplars were chosen from. */
  exemplarPool: z.int().nonnegative(),
  /** The template index the vectors came from (templateIndexName); null when it wasn't open. */
  exemplarIndex: z.string().min(1).max(200).nullable(),
});
export type StyleProfile = z.output<typeof styleProfileSchema>;

/**
 * Why no summary was written, plainly: no_model (no vision model on this Mac and no standing consent for a cloud
 * one), not_yet (the on-device model is still being installed, and no cloud consent), empty (nothing to summarise).
 */
export const STYLE_PROFILE_SUMMARY_SKIPS = ['no_model', 'not_yet', 'empty'] as const;
export type StyleProfileSummarySkip = (typeof STYLE_PROFILE_SUMMARY_SKIPS)[number];

/** The paragraph a vision model writes from the profile and the exemplars' contact sheets: on this Mac first. */
export const styleProfileSummarySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('writing'), at: z.int().nonnegative() }),
  z.object({
    state: z.literal('written'),
    /** Model output: untrusted, shown as plain text. */
    text: z.string().min(1).max(1200),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    /** Written on this Mac; false: by a cloud model under the standing upload consent for vision. */
    local: z.boolean(),
    at: z.int().nonnegative(),
  }),
  z.object({
    state: z.literal('none'),
    reason: z.enum(STYLE_PROFILE_SUMMARY_SKIPS),
    at: z.int().nonnegative(),
  }),
  z.object({ state: z.literal('failed'), error: publicErrorSchema, at: z.int().nonnegative() }),
]);
export type StyleProfileSummary = z.output<typeof styleProfileSummarySchema>;

/** An exemplar as the card shows it (no get needed): its name, its contact sheet's grid, length and slots. */
export const styleExemplarSchema = z.object({
  templateId: idSchema<'Template'>(),
  version: z.int().min(1),
  /** The template's name: user text (often from a reel's caption), shown as written. */
  name: z.string().min(1).max(120),
  contactSheet: contactSheetSchema
    .pick({ asset: true, mediaType: true, columns: true, rows: true, tile: true })
    .nullable(),
  duration: rationalTimeSchema,
  slotCount: z.int().min(1),
});
export type StyleExemplar = z.output<typeof styleExemplarSchema>;

export const styleProfileInputSchema = z.object({ source: styleSourceSchema });
export type StyleProfileInput = z.output<typeof styleProfileInputSchema>;

/** A set's profile as the renderer and the agent see it. */
export const styleProfileViewSchema = z.object({
  source: styleSourceSchema,
  /** The collection's or folder's name, or the tag; null for my exports. User or Instagram text, shown as written. */
  name: z.string().min(1).max(200).nullable(),
  /** Null while no member template exists (nothing broken down yet). */
  profile: styleProfileSchema.nullable(),
  summary: styleProfileSummarySchema,
  /** The profile's exemplars, in its order. */
  exemplars: z.array(styleExemplarSchema).max(STYLE_PROFILE_MAX_EXEMPLARS),
  /** When the stored profile was built; null when the set is empty. */
  builtAt: z.int().nonnegative().nullable(),
});
export type StyleProfileView = z.output<typeof styleProfileViewSchema>;
