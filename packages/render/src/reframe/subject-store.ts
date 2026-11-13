// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Subject tracks as derived JSON in the media cache (DERIVED_KINDS `subjectTrack`), keyed by the asset's
 * content hash, the shot's range and the detection recipe; core's SubjectTrackReader over them. A cache
 * eviction or a file that no longer parses is a miss, never an error: the export just tracks again.
 *
 * FRM1-SUB: each asset also has a small index of the ranges tracked for it, so a clip trimmed or moved inside a
 * tracked range reads that track (`covering`) instead of tracking again. The index is written by this process
 * only (the jobs process puts every track), one write at a time; a lost entry is only a miss.
 */
import { createHash } from 'node:crypto';
import {
  DERIVED_KEY_PATTERN,
  err,
  ok,
  RationalTime,
  subjectTrackSchema,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type DerivedFileRef,
  type SubjectTrack,
  type SubjectTrackReader,
  type TimeRange,
} from '@taalcut/core';
import { TRACK_RECIPE } from './subject-tracker';

/** The store's file layout version (the `.v<n>` of the key). */
export const SUBJECT_TRACK_FILE_VERSION = 1;

/** Text files under the media cache by derived key (desktop: media's DerivedCache). */
export interface DerivedJsonFiles {
  read(key: string): Promise<string | null>;
  write(key: string, body: string): AsyncResult<void>;
}

export interface SubjectTrackStoreDeps {
  readonly files: DerivedJsonFiles;
  /** The library's content hash of an asset (64 hex), or null when it has none yet. */
  contentHashOf(assetId: AssetId): AsyncResult<string | null>;
  /** The recipe this process's tracker makes (part of every key). Default: the mac helper's, TRACK_RECIPE. */
  readonly recipe?: unknown;
}

export interface SubjectTrackStore extends SubjectTrackReader {
  put(track: SubjectTrack): AsyncResult<DerivedFileRef>;
  keyFor(contentHash: string, range: TimeRange): string;
  /** A stored track (this recipe's) whose range holds [start, end), within a frame either side; else null. */
  covering(assetId: AssetId, start: RationalTime, end: RationalTime): AsyncResult<SubjectTrack | null>;
}

/** A frame at 30 fps: a range read at another rate rounds by less than this. */
const COVER_SLACK_SECONDS = 1 / 30;
const INDEX_LIMIT = 200;

interface IndexEntry {
  readonly start: number;
  readonly end: number;
  readonly key: string;
}

const sameTime = (a: TimeRange['start'], b: TimeRange['start']) =>
  a.value === b.value && a.rate.num === b.rate.num && a.rate.den === b.rate.den;

export function subjectTrackKey(
  contentHash: string,
  range: TimeRange,
  recipe: unknown = TRACK_RECIPE,
): string {
  const variant = createHash('sha256')
    .update(
      JSON.stringify([
        [range.start.value, range.start.rate.num, range.start.rate.den],
        [range.duration.value, range.duration.rate.num, range.duration.rate.den],
        recipe,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return `subjects/${contentHash.slice(0, 2)}/${contentHash}.r${variant}.v${SUBJECT_TRACK_FILE_VERSION}.json`;
}

const indexKey = (contentHash: string) =>
  `subjects/${contentHash.slice(0, 2)}/${contentHash}.ranges.v${SUBJECT_TRACK_FILE_VERSION}.json`;

function parseJson(body: string | null): unknown {
  if (body === null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function readIndex(json: unknown): IndexEntry[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (entry): entry is IndexEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as IndexEntry).start === 'number' &&
      typeof (entry as IndexEntry).end === 'number' &&
      typeof (entry as IndexEntry).key === 'string',
  );
}

export function createSubjectTrackStore(deps: SubjectTrackStoreDeps): SubjectTrackStore {
  const recipe = deps.recipe ?? TRACK_RECIPE;
  const keyFor = (contentHash: string, range: TimeRange) => subjectTrackKey(contentHash, range, recipe);
  let indexWrites: Promise<unknown> = Promise.resolve();
  const read = async (key: string, assetId: AssetId, hash: string): Promise<SubjectTrack | null> => {
    const parsed = subjectTrackSchema.safeParse(parseJson(await deps.files.read(key)));
    if (!parsed.success) return null;
    return parsed.data.assetId === assetId && parsed.data.contentHash === hash ? parsed.data : null;
  };
  const remember = (track: SubjectTrack, key: string) => {
    // One read-modify-write at a time: two tracks put together both land in the index.
    const next = indexWrites.then(async () => {
      const at = indexKey(track.contentHash);
      const start = RationalTime.toSeconds(track.range.start);
      const entry = { start, end: start + RationalTime.toSeconds(track.range.duration), key };
      const kept = readIndex(parseJson(await deps.files.read(at))).filter((old) => old.key !== key);
      await deps.files.write(at, JSON.stringify([...kept, entry].slice(-INDEX_LIMIT)));
    });
    indexWrites = next.catch(() => undefined);
    return next;
  };
  return {
    keyFor,
    async get(assetId, range) {
      const hash = await deps.contentHashOf(assetId);
      if (!hash.ok) return hash;
      if (!hash.value) return ok(null);
      const track = await read(keyFor(hash.value, range), assetId, hash.value);
      const matches =
        track !== null &&
        sameTime(track.range.start, range.start) &&
        sameTime(track.range.duration, range.duration);
      return ok(matches ? track : null);
    },
    async covering(assetId, start, end) {
      const hash = await deps.contentHashOf(assetId);
      if (!hash.ok) return hash;
      if (!hash.value) return ok(null);
      const from = RationalTime.toSeconds(start);
      const to = RationalTime.toSeconds(end);
      const entries = readIndex(parseJson(await deps.files.read(indexKey(hash.value))))
        .filter((entry) => entry.start <= from + COVER_SLACK_SECONDS && entry.end >= to - COVER_SLACK_SECONDS)
        // The tightest range first: its samples are the ones made for this clip.
        .sort((a, b) => a.end - a.start - (b.end - b.start));
      for (const entry of entries) {
        const track = await read(entry.key, assetId, hash.value);
        // Only a track of this recipe: its key is the one this store would give its range.
        if (track && keyFor(hash.value, track.range) === entry.key) return ok(track);
      }
      return ok(null);
    },
    async put(track) {
      const key = keyFor(track.contentHash, track.range);
      if (!DERIVED_KEY_PATTERN.test(key))
        return err(ValidationError({ field: 'contentHash' }, { detail: 'Not a 64-hex content hash' }));
      const body = JSON.stringify(track);
      const written = await deps.files.write(key, body);
      if (!written.ok) return written;
      await remember(track, key).catch((cause: unknown) => {
        console.warn('[render] could not index a subject track; a moved clip tracks again', cause);
      });
      return ok({
        kind: 'subjectTrack',
        key,
        bytes: Buffer.byteLength(body),
        mimeType: 'application/json',
        recipe: SUBJECT_TRACK_FILE_VERSION,
      });
    },
  };
}
