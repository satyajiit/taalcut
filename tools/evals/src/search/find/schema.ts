// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The find eval's inputs (LIB1-FIND): real clips with what they show (`search-find/clips.json`), the queries
 * people type and the clips that answer them (`queries.json`), and the describing model's answers recorded once
 * per prompt (`recordings/<name>.json`), so a run replays them offline through the app's own describe stage.
 *
 * Committed files hold the public Commons set only. A person's own clips are a local owner set
 * (`owner.local.json`, and `recordings/<name>.local.json` for their answers), gitignored: their labels, the
 * queries they answer and what a model said of them never leave the machine. Their ids are neutral (`owner-1`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { libraryFiltersSchema } from '@taalcut/core';
import { z } from 'zod';
import { readJson } from '../../files';
import { parseNamed } from '../../schema';

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** An owner clip's id: `owner-` and a neutral word or number, never what the clip shows. */
const ownerIdPattern = /^owner-[a-z0-9]+$/;
export const isOwnerClip = (id: string) => id.startsWith('owner-');

/** Licences a clip may carry: open ones only (Creative Commons BY, BY-SA, CC0, public domain). */
export const CLIP_LICENCES = [
  'CC0',
  'Public domain',
  'CC BY 2.0',
  'CC BY 3.0',
  'CC BY 4.0',
  'CC BY-SA 2.0',
  'CC BY-SA 3.0',
  'CC BY-SA 4.0',
] as const;

/** A clip from Wikimedia Commons: fetched, checked by its SHA-1 and cut to `seconds` from `start`. */
export const commonsClipSchema = z
  .object({
    id: z
      .string()
      .regex(idPattern)
      .refine((id) => !isOwnerClip(id), 'owner- ids are for the local owner set'),
    /** What it shows, for the reader of a report. Labels come from looking at the clip, never from a run. */
    shows: z.string().min(1),
    title: z.string().startsWith('File:'),
    page: z.url(),
    url: z.url(),
    /** SHA-1 of the bytes at `url` (for an original, the one Commons lists). */
    sha1: z.string().regex(/^[0-9a-f]{40}$/),
    bytes: z.int().positive(),
    /** Why `url` is one of Commons' transcodes, not the original (the bundled FFmpeg can't decode AV1). */
    transcode: z.string().min(1).optional(),
    licence: z.enum(CLIP_LICENCES),
    author: z.string(),
    start: z.number().nonnegative(),
    seconds: z.number().positive().max(10),
  })
  .strict();
export type CommonsClip = z.infer<typeof commonsClipSchema>;

/** A clip only the owner has (their phone's): never fetched or committed, copied in with `--owner <dir>`. */
export const ownerClipSchema = z
  .object({ id: z.string().regex(ownerIdPattern), shows: z.string().min(1), file: z.string().min(1) })
  .strict();
export type OwnerClip = z.infer<typeof ownerClipSchema>;

const uniqueIds = (path: string) => (items: readonly { id: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id))
      ctx.addIssue({ code: 'custom', path: [path, index, 'id'], message: 'duplicate id' });
    seen.add(item.id);
  }
};

export const clipFileSchema = z
  .object({ v: z.literal(1), about: z.string(), clips: z.array(commonsClipSchema).min(1) })
  .strict()
  .superRefine((file, ctx) => uniqueIds('clips')(file.clips, ctx));
export type ClipFile = z.infer<typeof clipFileSchema>;

/** Query languages: the app's four, and romanised Hindi mixed with English (Hinglish) as `hi-Latn`. */
export const FIND_LANGUAGES = ['en', 'hi', 'hi-Latn', 'es', 'pt-BR'] as const;
export type FindLanguage = (typeof FIND_LANGUAGES)[number];

/** What a query asks about: what people do, what is seen, where, a person on camera, or the footage's speed. */
export const QUERY_KINDS = ['action', 'scene', 'place', 'person', 'speed'] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

export const findQuerySchema = z
  .object({
    id: z.string().regex(idPattern),
    language: z.enum(FIND_LANGUAGES),
    kind: z.enum(QUERY_KINDS),
    text: z.string().min(1),
    /** Clip ids (whole clips: every shot of one answers). */
    relevant: z.array(z.string().regex(idPattern)).min(1),
    filters: libraryFiltersSchema.optional(),
    /** Scored only when the library has places (place's stage, LIB1-PLACE). */
    needs: z.enum(['places']).optional(),
  })
  .strict();
export type FindQuery = z.infer<typeof findQuerySchema>;

export const queryFileSchema = z
  .object({ v: z.literal(1), about: z.string(), queries: z.array(findQuerySchema).min(1) })
  .strict()
  .superRefine((file, ctx) => uniqueIds('queries')(file.queries, ctx));

/** The local owner set: the owner's clips, the committed queries they also answer, and queries of their own. */
export const ownerSetSchema = z
  .object({
    v: z.literal(1),
    about: z.string(),
    clips: z.array(ownerClipSchema).min(1),
    /** A committed query's id → the owner clips that answer it too. */
    relevant: z.record(z.string().regex(idPattern), z.array(z.string().regex(ownerIdPattern)).min(1)),
    queries: z.array(findQuerySchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueIds('clips')(file.clips, ctx);
    uniqueIds('queries')(file.queries, ctx);
  });
export type OwnerSet = z.infer<typeof ownerSetSchema>;

/** One describe request's answer: the clip, the request's place in its job, what the request said, the reply. */
export const recordedAnswerSchema = z
  .object({
    clip: z.string().regex(idPattern),
    n: z.int().nonnegative(),
    /** The request's text part (the shot's context and the ask). */
    text: z.string().min(1),
    /** SHA-256 of the frame sent, so a replay can say when it describes other pixels. */
    frame: z.string().regex(/^[0-9a-f]{64}$/),
    answer: z.string(),
  })
  .strict();
export type RecordedAnswer = z.infer<typeof recordedAnswerSchema>;

export const recordingFileSchema = z
  .object({
    v: z.literal(1),
    /** The first 12 hex digits of the system prompt's SHA-256. */
    prompt: z.string().regex(/^[0-9a-f]{12}$/),
    system: z.string().min(1),
    model: z
      .object({ provider: z.string().min(1), model: z.string().min(1), runtime: z.string().min(1) })
      .strict(),
    recordedAt: z.iso.datetime(),
    answers: z.array(recordedAnswerSchema),
  })
  .strict();
export type RecordingFile = z.infer<typeof recordingFileSchema>;

export function loadClips(path: string): ClipFile {
  return parseNamed(clipFileSchema, readJson(path), path);
}

export function loadQueries(path: string): FindQuery[] {
  return parseNamed(queryFileSchema, readJson(path), path).queries;
}

/** The local owner set beside the committed files, or null when there is none. */
export function loadOwnerSet(dataDir: string): OwnerSet | null {
  const path = join(dataDir, OWNER_SET);
  return existsSync(path) ? parseNamed(ownerSetSchema, readJson(path), path) : null;
}

export const OWNER_SET = 'owner.local.json';

/**
 * The queries a run scores: the committed ones, each with the owner clips that also answer it, then the owner
 * set's own. `commons` keeps each query's committed answers, so its Commons score never depends on the owner set.
 */
export function mergeQueries(
  committed: readonly FindQuery[],
  owner: OwnerSet | null,
): { readonly query: FindQuery; readonly commons: readonly string[] }[] {
  const merged = committed.map((query) => ({
    query: { ...query, relevant: [...query.relevant, ...(owner?.relevant[query.id] ?? [])] },
    commons: query.relevant,
  }));
  const ids = new Set(committed.map((query) => query.id));
  for (const id of Object.keys(owner?.relevant ?? {}))
    if (!ids.has(id)) throw new Error(`${OWNER_SET}: no committed query ${id}`);
  for (const query of owner?.queries ?? []) {
    if (ids.has(query.id)) throw new Error(`${OWNER_SET}: query ${query.id} is a committed one`);
    merged.push({ query, commons: query.relevant.filter((clip) => !isOwnerClip(clip)) });
  }
  return merged;
}

/** A recording's local part: the owner clips' answers, beside it as `<name>.local.json`. */
export const localRecordingPath = (path: string) => path.replace(/\.json$/, '') + '.local.json';

/** A recording and, when it is there, its local part's answers with it (same prompt and model). */
export function loadRecording(path: string): RecordingFile {
  const file = parseNamed(recordingFileSchema, readJson(path), path);
  const local = localRecordingPath(path);
  if (!existsSync(local)) return file;
  const own = parseNamed(recordingFileSchema, readJson(local), local);
  if (own.prompt !== file.prompt || own.model.model !== file.model.model)
    throw new Error(`${local} was recorded under another prompt or model than ${path}`);
  return { ...file, answers: [...file.answers, ...own.answers] };
}
