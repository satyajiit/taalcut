// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The SFX bank's catalogue (`sfx-bank` component, EAR1-D1/D2, D22): earshot's bank sounds rendered at build time
 * (tools/audio-packs/sfx-bank) into FLAC takes beside `catalogue.json`. Each item is one bank sound: its family
 * among the planner's four categories, the bank file it came from, its licence (MIT: every sound is made by earshot's
 * code, a fitted one too, which also credits the CC0 recording its model was measured from) and provenance, what
 * earshot's knobs could do to it, and its takes, each measured from the sound's start (onset, the loudest 5 ms, end,
 * momentary-max loudness) and audited clean; each file holds `padMs` of silence before and after the sound. A file
 * on disk, so it is validated on read; a sound no take of which passed the audit is listed under `withheld`, never
 * as an item.
 */
import {
  BUNDLED_LICENCES,
  SFX_CATEGORIES,
  sfxBankSoundIdSchema,
  sfxKitRoleSchema,
  soundAuditReportSchema,
} from '@taalcut/core';
import { z } from 'zod';

/** The bank files: forge v2 finals, the 0.4 members, earshot's models fitted to CC0 recordings, the tuned plucks. */
export const SFX_BANK_SOURCES = ['forge_v2', 'forge04', 'fit', 'pluck'] as const;
export type SfxBankSourceName = (typeof SFX_BANK_SOURCES)[number];
/** The listening model and dtypes the bank's embeddings may be computed with (F4's runner, per dtype). */
export const SFX_BANK_EMBEDDING_DTYPES = ['int8', 'fp16'] as const;
export type SfxBankEmbeddingDtype = (typeof SFX_BANK_EMBEDDING_DTYPES)[number];
export const SFX_BANK_EMBEDDING_DIMS = 512;

const ms = z.number().nonnegative().max(60_000);
/** A take's file in the component folder: no folders. */
export const sfxBankFileSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,96}\.flac$/);
/** earshot's id: `<category>/<member>`, or `fit/<role>/<name>`. */
const upstreamIdSchema = z.string().regex(/^[a-z][a-z0-9_]*\/[a-z0-9_.]+(?:\/[a-z0-9_]+)?$/);

export const sfxBankTakeSchema = z
  .object({
    file: sfxBankFileSchema,
    /** The seed it rendered on; `plannedSeed` when the audit made earshot re-roll it (seed + 1000 j). */
    seed: z.int().nonnegative(),
    plannedSeed: z.int().nonnegative(),
    /** The kit role its audit read it as, when that changes the audit (`hit`, `land`); null: its category only. */
    auditRole: z.enum(['hit', 'land']).nullable(),
    /** The note it was rendered at through the recipe's own pitch ('C5', 'Cs5', '445hz'); null: native. */
    pitch: z
      .string()
      .regex(/^(?:[A-G]s?-?\d|\d+(?:\.\d+)?hz)$/)
      .nullable(),
    /** The L/R correlation it was set to (a kit's `width`); null: as rendered. */
    width: z.number().min(0).max(1).nullable(),
    bits: z.union([z.literal(16), z.literal(24)]),
    channels: z.union([z.literal(1), z.literal(2)]),
    frames: z.int().positive(),
    durationMs: ms.positive(),
    /** The 1 ms envelope's first point within 30 dB of its maximum. */
    onsetMs: ms,
    /**
     * The centre of its loudest 5 ms, searched at every sample: what lands on a cut. Unlike a 1 ms grid's, it moves
     * with the sound, so a fluttering pass's near-equal maxima can't swap when the sound is placed off the grid.
     */
    apexMs: ms,
    /** earshot's own loudest 5 ms (`bank.times`, 1 ms hop from the take's start): a kit lock's `peak_s`. */
    peakMs: ms,
    /** The end of its last 5 ms within 50 dB of the loudest. */
    endMs: ms,
    peakDb: z.number().min(-70).max(0),
    /** Momentary-max loudness (BS.1770, 400 ms), for levelling under the music. */
    loudnessLufs: z.number().min(-70).max(0),
    /** The measured L/R correlation of a take set to a width. */
    corr: z.number().min(-1).max(1).optional(),
    /** sha256 of its interleaved PCM as rendered (16- or 24-bit little-endian): what decoding the FLAC gives back. */
    pcmSha256: z.string().regex(/^[0-9a-f]{64}$/),
    audit: soundAuditReportSchema,
  })
  .refine((t) => t.audit.ok, { message: 'A shipped take passes the audit', path: ['audit'] })
  .refine((t) => t.onsetMs <= t.apexMs + 2.5 && t.apexMs <= t.durationMs && t.endMs <= t.durationMs + 0.1, {
    message: 'onset, apex and end lie inside the take',
  });
export type SfxBankTake = z.output<typeof sfxBankTakeSchema>;

const knobsSchema = z.object({
  /** How earshot changes its length: the whoosh shape, a length parameter, or a trim. */
  dur: z.enum(['shape', 'param', 'trim']),
  /** Whether earshot can aim its loudest moment (the whoosh family). */
  apex: z.boolean(),
  /** Its native note, where earshot can retune it (the recipe's own pitch parameter, in this range). */
  pitch: z
    .object({
      nativeHz: z.number().positive(),
      note: z.string().max(16).nullable(),
      rangeHz: z.tuple([z.number().positive(), z.number().positive()]),
    })
    .nullable(),
});

export const sfxBankItemSchema = z
  .object({
    /** Taalcut's id (core's sfxBankSoundIdSchema): earshot's, with a fit's role folded in. */
    id: sfxBankSoundIdSchema,
    upstreamId: upstreamIdSchema,
    category: z.string().regex(/^[a-z][a-z0-9_]*$/),
    member: z
      .string()
      .regex(/^[a-z0-9_./]+$/)
      .max(64),
    /** Its own seed (the delivered final's): a kit's take k renders on this + k - 1 unless the role sets a seed. */
    seed: z.int().nonnegative(),
    title: z.string().min(1).max(120),
    family: z.enum(SFX_CATEGORIES),
    /** The kit roles / cue kinds earshot lists it for. */
    kinds: z.array(sfxKitRoleSchema).max(12),
    source: z.enum(SFX_BANK_SOURCES),
    licence: z.enum(BUNDLED_LICENCES),
    /** Where anyone can check the licence: the bank file at the pinned commit (fit.json for a fitted sound). */
    sourceUrl: z.url().max(500),
    /** The CC0 recording a fitted sound's model was measured from, its recordist and url; null for the others. */
    credit: z.string().min(1).max(300).nullable(),
    provenance: z.string().min(1).max(300),
    notes: z.string().max(600),
    knobs: knobsSchema,
    takes: z.array(sfxBankTakeSchema).min(1).max(64),
  })
  // D22: earshot's code renders every bank sound, a fitted one from its model, so each is MIT. The CC0 recording a
  // fit was measured from is a credit, not the sound's licence.
  .refine((item) => item.licence === 'MIT', {
    message: 'Every bank sound is rendered by code: MIT',
    path: ['licence'],
  })
  .refine((item) => (item.source === 'fit') === (item.credit !== null), {
    message: 'A fitted sound credits its recording',
    path: ['credit'],
  });
export type SfxBankItem = z.output<typeof sfxBankItemSchema>;

export const sfxBankEmbeddingSetSchema = z.object({
  model: z.literal('clap-general-audio'),
  dtype: z.enum(SFX_BANK_EMBEDDING_DTYPES),
  /** Little-endian float32, `rows` × `dims`, row i the unit CLAP audio embedding of items[i]'s first take. */
  file: z.string().regex(/^embeddings-(?:int8|fp16)\.f32$/),
  dims: z.literal(SFX_BANK_EMBEDDING_DIMS),
  rows: z.int().positive(),
});
export type SfxBankEmbeddingSet = z.output<typeof sfxBankEmbeddingSetSchema>;

export const sfxBankCatalogueSchema = z
  .object({
    version: z.literal(1),
    pack: z.literal('sfx-bank'),
    packVersion: z.string().min(1).max(40),
    upstream: z.object({
      repository: z.url(),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      version: z.string().max(20),
      bank: z.string().max(120),
    }),
    sampleRate: z.literal(48_000),
    /**
     * Digital silence before and after the sound in every take file, ms. A hit's clip starts and ends on frames,
     * so the pad keeps a sound whose apex lies within a frame of either end whole; take times don't count it.
     */
    padMs: z.number().nonnegative().max(200),
    items: z.array(sfxBankItemSchema).min(1).max(400),
    /** Sounds no take of which passed the audit (earshot's own rising zips, …): named, never placed. */
    withheld: z
      .array(
        z.object({ id: sfxBankSoundIdSchema, upstreamId: upstreamIdSchema, warnings: z.array(z.string()) }),
      )
      .max(400),
    embeddings: z.array(sfxBankEmbeddingSetSchema).max(SFX_BANK_EMBEDDING_DTYPES.length),
  })
  .superRefine((catalogue, ctx) => {
    const ids = new Set<string>();
    const files = new Set<string>();
    for (const [i, item] of catalogue.items.entries()) {
      if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `${item.id} twice`, path: ['items', i] });
      ids.add(item.id);
      for (const file of new Set(item.takes.map((t) => t.file))) {
        if (files.has(file)) ctx.addIssue({ code: 'custom', message: `${file} twice`, path: ['items', i] });
        files.add(file);
      }
    }
    for (const set of catalogue.embeddings)
      if (set.rows !== catalogue.items.length)
        ctx.addIssue({ code: 'custom', message: `${set.file} has ${set.rows} rows`, path: ['embeddings'] });
  });
export type SfxBankCatalogue = z.output<typeof sfxBankCatalogueSchema>;
