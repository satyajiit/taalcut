// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's vocabulary and the views a window gets (P2-L1, P2-L2,
 * P2-L3): assets, shots, search hits, sources and storage. Stored rows stay
 * in @taalcut/library; these are what crosses IPC. Text from the user's disk
 * or a model (file names, descriptions, transcripts) is plain text.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { assetContactSheetSchema } from '../analysis/contact-sheet';
import {
  captureOffsetSchema,
  derivedFileRefSchema,
  mediaFactsSchema,
  ORIENTATIONS,
  thumbnailRefSchema,
} from '../analysis/media-facts';
import { shotActionSchema, shotAnalysisSchema } from '../analysis/shot-analysis';
import { spokenLanguageOutcomeSchema } from '../analysis/language';
import { spokenLanguageSchema } from '../analysis/transcript';
import { mediaUrl, originalMediaUrl } from '../basics/csp';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { assetProvenanceSchema } from './asset-provenance';
import { indexMilestoneSchema } from './index-milestones';
import { assetHoldSchema, stageProgressFields } from './index-progress';
import { countryCodeSchema, placeSchema, tripIdSchema, tripSchema } from './places';
import { beatMapSchema, CAMERA_MOTIONS, SHOT_TYPES } from '../templates/template-parts';
import { frameRateSchema } from '../time/frame-rate';
import { rationalTimeSchema } from '../time/rational-time';
import { timeRangeSchema } from '../time/time-range';

export const ASSET_KINDS = ['video', 'image', 'audio', 'live_photo'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
/** P3: stock imports, generated files and bundled packs each get a source too. */
export const SOURCE_KINDS = [
  'wifi_import',
  'usb_import',
  'local_import',
  'camera_import',
  'photos_import',
  'watched_folder',
  'stock_import',
  'generated',
  'bundled',
] as const;
export const SOURCE_STATUSES = ['online', 'offline', 'missing'] as const;
export const AVAILABILITIES = ['online', 'offline', 'missing', 'icloud_placeholder'] as const;
export const LOCATION_STATES = ['present', 'offline', 'missing', 'icloud_placeholder'] as const;
/** Why a search hit matched, for the result chips. */
export const MATCH_KINDS = ['visual', 'description', 'speech', 'onScreenText', 'keyword'] as const;
export const INDEX_STAGE_STATES = ['waiting', 'queued', 'running', 'done', 'skipped', 'failed'] as const;
const ASSET_INDEX_STATES = ['waiting', 'indexing', 'done', 'failed'] as const;

/** Wi-Fi uploads: did the phone send a smaller copy? (transfer SPEC, "Re-encode check"). */
export const REENCODE_VERDICTS = ['likely', 'unlikely', 'unknown'] as const;
export const REENCODE_SIGNALS = [
  'ios-browser',
  'h264-aac',
  'no-camera-metadata',
  'export-file-name',
  'fresh-file-time',
  'jpeg-without-camera-exif',
  'hevc',
  'camera-metadata',
  /** USB (P3-B4, P3-B5): the device sent a converted copy (JPEG or H.264 for a HEIC or HEVC original). */
  'device-converted',
] as const;
export const reencodeCheckSchema = z.object({
  verdict: z.enum(REENCODE_VERDICTS),
  reasons: z.array(z.enum(REENCODE_SIGNALS)).max(8),
});
export type ReencodeCheck = z.output<typeof reencodeCheckSchema>;

const score = z.number().min(0).max(1);
const epochMs = z.int().nonnegative();

export const libraryFiltersSchema = z.object({
  kinds: z.array(z.enum(ASSET_KINDS)).max(4).optional(),
  orientations: z.array(z.enum(ORIENTATIONS)).max(3).optional(),
  minDuration: rationalTimeSchema.optional(),
  maxDuration: rationalTimeSchema.optional(),
  /** Against ShotAnalysis.quality.overall. */
  minQuality: score.optional(),
  capturedFrom: epochMs.optional(),
  capturedTo: epochMs.optional(),
  sourceIds: z.array(idSchema<'Source'>()).max(50).optional(),
  languages: z.array(spokenLanguageSchema).max(8).optional(),
  hasSpeech: z.boolean().optional(),
  /** Default: online, offline and icloud_placeholder. */
  availability: z.array(z.enum(AVAILABILITIES)).max(4).optional(),
  /** Default true: one shot per near-duplicate group. */
  bestTakesOnly: z.boolean().optional(),
  includeTrashed: z.boolean().optional(),
  includeGenerated: z.boolean().optional(),
  /** e.g. ['failed'] for the grid's failed-files filter. */
  indexStates: z.array(z.enum(ASSET_INDEX_STATES)).max(4).optional(),
  /** LIB1-FIND: shots showing any of these actions (ShotDescription.actions); an asset with one such shot. */
  actions: z.array(shotActionSchema).min(1).max(10).optional(),
  /** LIB1-FIND: clips in any of these trips (LIB1-PLACE's `Trip.id`). */
  tripIds: z.array(tripIdSchema).min(1).max(20).optional(),
  /** LIB1-FIND: clips placed in any of these countries (ISO 3166-1 alpha-2, gps or nearby). */
  countries: z.array(countryCodeSchema).min(1).max(20).optional(),
  /** LIB1-FIND: clips placed in any of these cities (`Place.cityId`, GeoNames ids), on the same terms. */
  cityIds: z.array(z.int().positive()).min(1).max(20).optional(),
});
export type LibraryFilters = z.output<typeof libraryFiltersSchema>;

/** One action the library's shots show, and how many clips show it (the action filter's choices, LIB1-FIND). */
export const actionCountSchema = z.object({
  action: shotActionSchema,
  assets: z.int().positive(),
});
export type ActionCount = z.output<typeof actionCountSchema>;
/** The most actions the library lists for the filter: its most common ones. */
export const ACTION_COUNTS_MAX = 100;

export const assetSummarySchema = z.object({
  id: idSchema<'Asset'>(),
  kind: z.enum(ASSET_KINDS),
  /** The original file name, from the user's disk or phone: plain text. */
  name: z.string(),
  capturedAt: epochMs.nullable(),
  /**
   * The UTC offset where it was shot, for its local time and day (LIB1-OEM): `from: 'file'` when the clip's facts
   * say, `'nearby'` when borrowed from a clip of the same source shot within 12 hours that has its own. null when
   * neither says. Absent from a summary made before LIB1.
   */
  captureOffset: captureOffsetSchema.nullable().optional(),
  addedAt: epochMs,
  duration: rationalTimeSchema.nullable(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  orientation: z.enum(ORIENTATIONS).nullable(),
  availability: z.enum(AVAILABILITIES),
  sourceIds: z.array(idSchema<'Source'>()).max(20),
  /** The first described shot's description (model-written): plain text. */
  description: z.string().nullable(),
  quality: score.nullable(),
  shotCount: z.int().nonnegative(),
  language: spokenLanguageSchema.nullable(),
  index: z.object({
    state: z.enum(ASSET_INDEX_STATES),
    done: z.int().nonnegative(),
    total: z.int().nonnegative(),
    /**
     * When the asset became searchable (round IX, epoch ms): its searchable stages all done or
     * skipped. null until then, and again while a re-index runs them anew; `state` still says
     * whether deeper analysis carries on. Absent from a summary made before round IX.
     */
    searchableAt: epochMs.nullable().optional(),
    /** LIB1-PROG: what holds it while it waits (index-progress.ts); absent while it runs or nothing does. */
    held: assetHoldSchema.optional(),
  }),
  thumbnail: thumbnailRefSchema.nullable(),
  reencode: z.enum(REENCODE_VERDICTS).nullable(),
  trashed: z.boolean(),
  /** P3: captured, generated, bundled or stock. */
  provenance: assetProvenanceSchema,
  /**
   * Where it was shot, in words (LIB1-PLACE, places.ts): its own coordinates, a neighbour's, or its time zone as a
   * hint. null when nothing says; absent from a summary made before LIB1.
   */
  place: placeSchema.nullable().optional(),
  /** The trip it is part of (LIB1-PLACE); null when none; absent from a summary made before LIB1. */
  trip: tripSchema.nullable().optional(),
  /**
   * How `language` was decided (LIB1-LANG, analysis/language.ts): detected, mixed, unclear or chosen by the person.
   * Absent before LIB1 and until the clip's speech was listened to; a clip with no speech has none.
   */
  speech: spokenLanguageOutcomeSchema.optional(),
  /**
   * LIB1-LANG: Taalcut is deciding the clip's spoken language again. The language it had came from before this
   * version's decision (a guess, not a decision), so `language` is null and `speech` absent until the new one
   * lands. Absent otherwise.
   */
  languagePending: z.literal(true).optional(),
});
export type AssetSummary = z.output<typeof assetSummarySchema>;

export const shotSummarySchema = z.object({
  id: idSchema<'Shot'>(),
  assetId: idSchema<'Asset'>(),
  index: z.int().nonnegative(),
  range: timeRangeSchema,
  description: z.string().nullable(),
  shotType: z.enum(SHOT_TYPES).nullable(),
  motion: z.enum(CAMERA_MOTIONS).nullable(),
  quality: score.nullable(),
  bestTake: z.boolean(),
  thumbnail: thumbnailRefSchema.nullable(),
});
export type ShotSummary = z.output<typeof shotSummarySchema>;

export const shotDetailSchema = shotSummarySchema.extend({
  /** null until vision analysed the shot. */
  analysis: shotAnalysisSchema.nullable(),
  /** Speech inside the shot's range: plain text. */
  transcriptText: z.string().nullable(),
  duplicateGroup: idSchema<'Shot'>().nullable(),
});
export type ShotDetail = z.output<typeof shotDetailSchema>;

export const searchHitSchema = z.object({
  shot: shotSummarySchema,
  asset: assetSummarySchema,
  /** Fused rank score over its maximum, 0..1: for ordering and debugging, not shown as a percentage. */
  score,
  matchedBy: z.array(z.enum(MATCH_KINDS)).min(1).max(5),
  /** A matching passage as plain text; highlights are [start, end) UTF-16 offsets into it. */
  snippet: z
    .object({
      field: z.enum(['transcript', 'onScreenText', 'description']),
      text: z.string().max(400),
      highlights: z.array(z.tuple([z.int().nonnegative(), z.int().nonnegative()])).max(20),
    })
    .optional(),
});
export type SearchHit = z.output<typeof searchHitSchema>;

export const searchResultSchema = z.object({
  hits: z.array(searchHitSchema).max(100),
  tookMs: z.int().nonnegative(),
  /** Vector search unavailable (embedding model not installed yet): keyword results only. */
  degraded: z.enum(['keyword-only']).optional(),
});
export type SearchResult = z.output<typeof searchResultSchema>;

/** A transcript segment without word timings, for previews. */
export const transcriptLineSchema = z.object({
  text: z.string().max(4000),
  range: timeRangeSchema,
  speaker: z.string().max(32).optional(),
});

/**
 * A clip's sound in brief (UX2): the loudest moment of each bucket as 0 (silence) to 1 (full scale), the buckets
 * evenly spaced from the clip's start, `bucketsPerSecond` of them a second. At most 4,000 buckets, so a long clip is
 * summarised more coarsely; drawn by the renderer, never used as time.
 */
export const waveformSummarySchema = z.object({
  bucketsPerSecond: z.number().positive().max(1000),
  peaks: z.array(z.number().min(0).max(1)).max(4000),
});
export type WaveformSummary = z.output<typeof waveformSummarySchema>;

/**
 * What the clip page's viewer plays (UX2): media.proxy's H.264 copy (upright, short GOP), or, when media.proxy found
 * the original small and plain enough to be its own proxy, the original itself (upright already; its size, length
 * and rate from the facts). Main serves either on the media host in byte ranges (`playbackUrl`).
 */
export const playbackSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('proxy'),
    file: derivedFileRefSchema.refine((ref) => ref.kind === 'proxy' && ref.mimeType === 'video/mp4', {
      message: 'Expected a proxy',
    }),
  }),
  z.object({
    source: z.literal('original'),
    width: z.int().positive(),
    height: z.int().positive(),
    duration: rationalTimeSchema,
    frameRate: frameRateSchema,
  }),
]);
export type Playback = z.output<typeof playbackSchema>;

/** Where the renderer loads a clip's playback from. */
export function playbackUrl(assetId: string, playback: Playback): string {
  return playback.source === 'proxy' ? mediaUrl(playback.file) : originalMediaUrl(assetId);
}

/** At most this many frames in a clip's filmstrip: the widest strip's slots for the narrowest frame (UX2). */
export const FILMSTRIP_MAX_FRAMES = 80;

/**
 * A clip's filmstrip (UX2), made at import by media.filmstrip from the copy to play: one JPEG sprite of
 * `times.length` frames evenly spaced from the clip's first frame to its last, each `tileWidth` × `tileHeight`
 * pixels, in `columns` × `rows` cells read left to right, top to bottom (frame i in cell i, at `times[i]`). The
 * renderer draws the scrubber's strip and the frame under the pointer from it alone, on the media host.
 */
export const filmstripSchema = z
  .object({
    file: derivedFileRefSchema.refine((ref) => ref.kind === 'filmstrip' && ref.mimeType === 'image/jpeg', {
      message: 'Expected a filmstrip sprite',
    }),
    columns: z.int().positive().max(FILMSTRIP_MAX_FRAMES),
    rows: z.int().positive().max(FILMSTRIP_MAX_FRAMES),
    tileWidth: z.int().positive().max(4096),
    tileHeight: z.int().positive().max(4096),
    times: z.array(rationalTimeSchema).min(1).max(FILMSTRIP_MAX_FRAMES),
  })
  .refine((strip) => strip.times.length <= strip.columns * strip.rows, {
    message: 'More frames than the sprite has cells',
  });
export type Filmstrip = z.output<typeof filmstripSchema>;

export const assetDetailSchema = z.object({
  asset: assetSummarySchema,
  /** null until media.normalise ran. Its location is shown on this Mac only. */
  facts: mediaFactsSchema.nullable(),
  shots: z.array(shotDetailSchema).max(5000),
  /** The first lines; page the rest (with word timings) through library.transcript. */
  transcript: z
    .object({
      language: spokenLanguageSchema,
      lines: z.array(transcriptLineSchema).max(500),
      truncated: z.boolean(),
    })
    .nullable(),
  locations: z
    .array(
      z.object({
        id: idSchema<'AssetLocation'>(),
        sourceId: idSchema<'Source'>(),
        sourceName: z.string(),
        storage: z.enum(['managed', 'referenced']),
        state: z.enum(LOCATION_STATES),
        /** Inside the source's folder, for display. */
        relativePath: z.string(),
        volumeName: z.string().nullable(),
      }),
    )
    .max(20),
  reencodeReasons: z.array(z.enum(REENCODE_SIGNALS)).max(8),
  stages: z
    .array(
      z.object({
        stage: z.string(),
        state: z.enum(INDEX_STAGE_STATES),
        /** The finish line the stage counts toward (round IX); absent before. */
        milestone: indexMilestoneSchema.optional(),
        error: publicErrorSchema.optional(),
        /** Why it was skipped or is waiting (an i18n key: `indexing.skip.*`, `library.stage.*`). */
        reasonKey: z.string().max(120).optional(),
        /** LIB1-PROG: its job, saved progress, start and usual length (index-progress.ts). */
        ...stageProgressFields,
      }),
    )
    .max(32),
  /**
   * What the viewer plays (UX2, `playbackSchema`). Null until media.proxy has run (not yet, waiting, running or
   * failed: the stages say which), and for a still or a sound file.
   */
  playback: playbackSchema.nullable(),
  /** The scrubber's frames (UX2, `filmstripSchema`); null until made or if evicted, and for stills/audio. */
  filmstrip: filmstripSchema.nullable(),
  /** Annotated Set-of-Mark contact sheet (`vision.contactSheet`); null/absent until made or if evicted. */
  contactSheet: assetContactSheetSchema.nullable().optional(),
  /**
   * The clip's sound, for its sound lane (UX2): null for a clip without sound, before media.previews drew it, or once
   * the media cache let its waveform go.
   */
  waveform: waveformSummarySchema.nullable(),
  /** The clip's own beats when audio.beats ran on it (today only music files), for the beat marks (UX2). */
  beats: beatMapSchema.nullable(),
  /** The original's size on disk in bytes, as it was imported (UX2). */
  sizeBytes: z.int().nonnegative(),
});
export type AssetDetail = z.output<typeof assetDetailSchema>;

/** A source row (the sourcePicker card, Settings → Sources). */
export const sourceViewSchema = z.object({
  id: idSchema<'Source'>(),
  kind: z.enum(SOURCE_KINDS),
  /** The user's label, a folder name or a phone's device label: plain text. */
  name: z.string(),
  status: z.enum(SOURCE_STATUSES),
  /** The folder's path, for watched folders (the user's own folder, shown in Settings → Sources). */
  path: z.string().nullable(),
  watch: z.boolean(),
  scan: z.object({
    state: z.enum(['idle', 'scanning', 'error']),
    lastScanAt: epochMs.nullable(),
    error: publicErrorSchema.optional(),
  }),
  assets: z.int().nonnegative(),
  missing: z.int().nonnegative(),
  createdAt: epochMs,
});
export type SourceView = z.output<typeof sourceViewSchema>;

export const libraryStorageSchema = z.object({
  originalsRoot: z.object({
    path: z.string(),
    volumeName: z.string().nullable(),
    online: z.boolean(),
    freeBytes: z.int().nonnegative().nullable(),
    usedBytes: z.int().nonnegative(),
  }),
  catalogBytes: z.int().nonnegative(),
});
export type LibraryStorage = z.output<typeof libraryStorageSchema>;
