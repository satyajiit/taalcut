// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.getAsset`'s input, output and body: the asset detail the asset page
 * reads, reshaped for a model. No coordinates (latitude and longitude stay on
 * this Mac): where it was filmed and its trip go by name only (LIB1-FIND). No
 * device names, no absolute paths. A transcript longer than a screenful goes
 * into an artifact, with its first lines inline.
 */
import {
  artifactRefSchema,
  ok,
  parseId,
  placeInWords,
  type ArtifactStore,
  type AssetContactSheet,
  type AsyncResult,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { assetDetail, type StoredAssetDetail } from '../profile';
import { plainTime, plainTimeSchema } from './tool-schemas';

export interface ContactSheetPictures {
  readonly shown: boolean;
  readonly why: string;
}

export type AssetContactSheetReader = (
  sheet: AssetContactSheet,
  signal: AbortSignal,
) => AsyncResult<{ readonly bytes: Uint8Array; readonly pictures: ContactSheetPictures } | null>;

const fromDisk = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'file-system' });
const fromMedia = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'media' });

/** Lines shown inline; a longer transcript goes to an artifact. */
const INLINE_LINES = 20;
const INLINE_CHARS = 2_000;

export const getAssetInput = z.object({
  assetId: ulidSchema('Asset').describe('An asset id from library.search'),
  include: z
    .array(z.enum(['shots', 'transcript', 'locations']))
    .max(3)
    .default(['shots', 'transcript'])
    .describe('Parts beyond the facts; default shots and transcript'),
});

const time = plainTimeSchema;
export const getAssetOutput = z.object({
  asset: z.object({
    id: z.string(),
    kind: z.enum(['video', 'image', 'audio', 'live_photo']),
    fileName: fromDisk(z.string()),
    capturedAt: z.int().nullable(),
    duration: time.nullable(),
    width: z.int().nullable(),
    height: z.int().nullable(),
    orientation: z.enum(['portrait', 'landscape', 'square']).nullable(),
    availability: z.enum(['online', 'offline', 'missing', 'icloud_placeholder']),
    language: z.string().nullable(),
    quality: z.number().nullable(),
    shotCount: z.int(),
    indexState: z.enum(['waiting', 'indexing', 'done', 'failed']),
    trashed: z.boolean(),
    /**
     * Where it was filmed: in words ("near Sintra, Lisbon, Portugal"; "probably …" when only its time zone says),
     * how that is known, and the country and city to filter by (no coordinates). Null: unknown.
     */
    place: z
      .object({
        words: z.string(),
        basis: z.enum(['gps', 'nearby', 'zone']),
        country: z.string().nullable(),
        cityId: z.int().nullable(),
      })
      .nullable(),
    /** The trip it belongs to: its name (null: named by place and month) and the month it started. */
    trip: z
      .object({
        id: z.string(),
        name: z.string().nullable().meta({ untrusted: 'user-text' }),
        month: z.string(),
      })
      .nullable(),
  }),
  facts: z
    .object({
      frameRate: z.object({ num: z.int(), den: z.int() }).nullable(),
      hdr: z.string(),
      speed: z.string(),
      speedFactor: z.number(),
      hasAudio: z.boolean(),
    })
    .nullable(),
  shots: z
    .array(
      z.object({
        shotId: z.string(),
        index: z.int(),
        start: time,
        duration: time,
        description: fromMedia(z.string().nullable()),
        objects: z.array(fromMedia(z.string())),
        /** What people in it are doing ("dancing", "playing music"), fixed words first. */
        actions: z.array(fromMedia(z.string())),
        place: fromMedia(z.string().nullable()),
        shotType: z.string().nullable(),
        motion: z.string().nullable(),
        quality: z.number().nullable(),
        onScreenText: z.array(fromMedia(z.string())),
        speech: fromMedia(z.string().nullable()),
        bestTake: z.boolean(),
      }),
    )
    .optional(),
  transcript: z
    .object({
      language: z.string(),
      lines: z.array(z.object({ text: fromMedia(z.string()), start: time, duration: time })),
      truncated: z.boolean(),
      /** The whole transcript as text, when it was too long to show here. */
      artifact: artifactRefSchema.optional(),
    })
    .nullable()
    .optional(),
  locations: z
    .array(
      z.object({
        sourceName: fromDisk(z.string()),
        relativePath: fromDisk(z.string()),
        storage: z.enum(['managed', 'referenced']),
        state: z.enum(['present', 'offline', 'missing', 'icloud_placeholder']),
      }),
    )
    .optional(),
  /**
   * Annotated Set-of-Mark contact sheet (`#1 · MM:SS.t` badges across the clip's shots), shown as an image when
   * footage pictures are permitted and accompanied by tile-to-frame/timestamp/shotId mapping.
   */
  contactSheet: z
    .object({
      image: artifactRefSchema.nullable(),
      width: z.int(),
      height: z.int(),
      columns: z.int(),
      tileWidth: z.int(),
      tileHeight: z.int(),
      frameRate: z.object({ num: z.int(), den: z.int() }),
      tiles: z.array(
        z.object({
          tile: z.int(),
          badge: z.string(),
          frame: z.int(),
          at: time,
          shotId: z.string().optional(),
        }),
      ),
      pictures: z.object({
        footage: z.enum(['shown', 'kept_on_device']),
        why: z.string(),
      }),
    })
    .nullable()
    .optional(),
  contactSheetStatus: z.enum(['indexing']).optional(),
});

type Output = z.input<typeof getAssetOutput>;

function shotsOf(detail: StoredAssetDetail): NonNullable<Output['shots']> {
  return detail.shots.map((shot) => {
    const description = shot.analysis?.description;
    return {
      shotId: shot.id,
      index: shot.index,
      start: plainTime(shot.range.start),
      duration: plainTime(shot.range.duration),
      description: shot.description,
      objects: description?.objects ? [...description.objects] : [],
      actions: description?.actions ? [...description.actions] : [],
      place: description?.place ?? null,
      shotType: shot.shotType,
      motion: shot.motion,
      quality: shot.quality,
      onScreenText: shot.analysis?.onScreenText.map((t) => t.text) ?? [],
      speech: shot.transcriptText,
      bestTake: shot.bestTake,
    };
  });
}

async function transcriptOf(
  detail: StoredAssetDetail,
  artifacts: ArtifactStore,
): Promise<NonNullable<Output['transcript']> | null> {
  const transcript = detail.transcript;
  if (!transcript) return null;
  const lines = transcript.lines.map((l) => ({
    text: l.text,
    start: plainTime(l.range.start),
    duration: plainTime(l.range.duration),
  }));
  const text = transcript.lines.map((l) => l.text).join('\n');
  if (lines.length <= INLINE_LINES && text.length <= INLINE_CHARS && !transcript.truncated)
    return { language: transcript.language, lines, truncated: false };
  const stored = await artifacts.put({
    mediaType: 'text/plain',
    data: text,
    summary: `Transcript (${transcript.language}), ${transcript.lines.length} lines${transcript.truncated ? ', the first 500' : ''}.`,
  });
  return {
    language: transcript.language,
    lines: lines.slice(0, INLINE_LINES),
    truncated: true,
    // Without an artifact store (an in-memory library) the first lines are all the model gets.
    ...(stored.ok ? { artifact: stored.value } : {}),
  };
}

async function contactSheetToolOutput(
  detail: StoredAssetDetail,
  artifacts: ArtifactStore,
  reader?: AssetContactSheetReader,
  signal?: AbortSignal,
): Promise<NonNullable<Output['contactSheet']> | null | undefined> {
  if (!detail.contactSheet || !reader) return undefined;
  const sheet = detail.contactSheet;
  const read = await reader(sheet, signal ?? new AbortController().signal);
  if (!read.ok || !read.value) return null;
  const { bytes, pictures } = read.value;
  const stored = pictures.shown
    ? await artifacts.put({
        mediaType: 'image/jpeg',
        data: bytes,
        summary: `Contact sheet (${sheet.layout.length} tiles) for ${detail.asset.name}`,
      })
    : null;
  const image = stored && stored.ok ? stored.value : null;
  return {
    image,
    width: sheet.width,
    height: sheet.height,
    columns: sheet.columns,
    tileWidth: sheet.tileWidth,
    tileHeight: sheet.tileHeight,
    frameRate: { num: sheet.frameRate.num, den: sheet.frameRate.den },
    tiles: sheet.layout.map((t) => ({
      tile: t.tile,
      badge: `#${t.tile + 1}`,
      frame: t.frame,
      at: plainTime(t.at),
      ...(t.shotId ? { shotId: t.shotId } : {}),
    })),
    pictures: {
      footage: image ? 'shown' : 'kept_on_device',
      why: pictures.why,
    },
  };
}

function isContactSheetIndexing(detail: StoredAssetDetail): boolean {
  if (detail.asset.kind !== 'video' || detail.contactSheet != null) return false;
  const csStage = detail.stages.find((stage) => stage.stage === 'vision.contactSheet');
  if (csStage) {
    return csStage.state !== 'done' && csStage.state !== 'skipped' && csStage.state !== 'failed';
  }
  if (detail.stages.length > 0) {
    return detail.stages.some(
      (stage) => stage.state !== 'done' && stage.state !== 'skipped' && stage.state !== 'failed',
    );
  }
  return detail.asset.index.state === 'waiting' || detail.asset.index.state === 'indexing';
}

export interface AssetToolOptions {
  readonly contactSheet?: AssetContactSheetReader;
  readonly signal?: AbortSignal;
}

export async function assetToolOutput(
  db: LibraryDatabase,
  input: z.output<typeof getAssetInput>,
  artifacts: ArtifactStore,
  options?: AssetToolOptions,
): AsyncResult<Output> {
  const assetId = parseId<'Asset'>(input.assetId);
  if (!assetId.ok) return assetId;
  const found = assetDetail(db, assetId.value);
  if (!found.ok) return found;
  const detail = found.value;
  const { asset, facts } = detail;
  const include = new Set(input.include);
  const contactSheet = include.has('shots')
    ? await contactSheetToolOutput(detail, artifacts, options?.contactSheet, options?.signal)
    : undefined;
  const contactSheetIndexing = contactSheet == null && isContactSheetIndexing(detail);
  return ok({
    asset: {
      id: asset.id,
      kind: asset.kind,
      fileName: asset.name,
      capturedAt: asset.capturedAt,
      duration: asset.duration ? plainTime(asset.duration) : null,
      width: asset.width,
      height: asset.height,
      orientation: asset.orientation,
      availability: asset.availability,
      language: asset.language,
      quality: asset.quality,
      shotCount: asset.shotCount,
      indexState: asset.index.state,
      trashed: asset.trashed,
      place: asset.place
        ? {
            words: placeInWords(asset.place),
            basis: asset.place.basis,
            country: asset.place.basis === 'zone' ? null : asset.place.country,
            cityId: asset.place.basis === 'zone' ? null : asset.place.cityId,
          }
        : null,
      trip: asset.trip ? { id: asset.trip.id, name: asset.trip.name, month: asset.trip.month } : null,
    },
    facts: facts
      ? {
          frameRate: facts.frameRate ? { num: facts.frameRate.num, den: facts.frameRate.den } : null,
          hdr: facts.hdr,
          speed: facts.speed,
          speedFactor: facts.speedFactor,
          hasAudio: facts.hasAudio,
        }
      : null,
    ...(include.has('shots') ? { shots: shotsOf(detail) } : {}),
    ...(contactSheet !== undefined ? { contactSheet } : {}),
    ...(contactSheetIndexing ? { contactSheetStatus: 'indexing' as const } : {}),
    ...(include.has('transcript') ? { transcript: await transcriptOf(detail, artifacts) } : {}),
    ...(include.has('locations')
      ? {
          locations: detail.locations.map((l) => ({
            sourceName: l.sourceName,
            relativePath: l.relativePath,
            storage: l.storage,
            state: l.state,
          })),
        }
      : {}),
  });
}
