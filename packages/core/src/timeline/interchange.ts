// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pro export (P3-V5): a timeline as an OpenTimelineIO or Final Cut Pro XML file for another editor. The timeline
 * package writes it (`timeline.exportInterchange`), the agent process's ExportFileSink stores it in Taalcut's
 * exports folder, and main's `files.saveExportAs` lets the person save a copy. Paths never reach a window.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type AssetId, type ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { FrameRate } from '../time/frame-rate';

export const INTERCHANGE_FORMATS = ['otio', 'fcpxml'] as const;
export type InterchangeFormat = (typeof INTERCHANGE_FORMATS)[number];
/** How media paths are written: file:// URLs (Resolve, Final Cut) or POSIX paths. */
export const INTERCHANGE_PATH_STYLES = ['fileUrl', 'posixPath'] as const;
export type InterchangePathStyle = (typeof INTERCHANGE_PATH_STYLES)[number];

/** What another editor won't get exactly as Taalcut plays it. */
export const interchangeWarningSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('mediaOffline'), clipId: idSchema<'TimelineItem'>() }),
  z.object({ code: z.literal('rampApproximated'), clipId: idSchema<'TimelineItem'>() }),
  z.object({ code: z.literal('transitionAsCut'), itemId: idSchema<'TimelineItem'>() }),
  z.object({ code: z.literal('textAsMarker'), count: z.int().positive() }),
  z.object({ code: z.literal('imageAsStill'), clipId: idSchema<'TimelineItem'>() }),
]);
export type InterchangeWarning = z.output<typeof interchangeWarningSchema>;

export const interchangeFormatSchema = z.object({
  id: z.enum(INTERCHANGE_FORMATS),
  /** The format's own version, as the writers report it: OTIO '0.18.1', FCPXML '1.14'. */
  version: z.string().min(1),
  fileExtension: z.string().regex(/^\.[a-z0-9]+$/),
  labelKey: z.string().min(1),
});
export type InterchangeFormatInfo = z.output<typeof interchangeFormatSchema>;

/** `timeline.exportInterchange`'s result. */
export const interchangeExportResultSchema = z.object({
  /** The file's name in the exports folder, for files.saveExportAs. */
  fileName: z.string().min(1).max(255),
  warnings: z.array(interchangeWarningSchema).max(500),
});
export type InterchangeExportResult = z.output<typeof interchangeExportResultSchema>;

/** Where the agent process writes exports that aren't renders. The desktop implements it (Taalcut's exports folder). */
export interface ExportFileSink {
  writeBytes?(input: {
    readonly projectId: ProjectId;
    readonly baseName: string;
    readonly extension: string;
    readonly bytes: Uint8Array;
  }): AsyncResult<{ readonly fileName: string }>;

  write(input: {
    readonly projectId: ProjectId;
    /** Plain text; the sink makes it safe and unique. */
    readonly baseName: string;
    readonly extension: string;
    readonly text: string;
  }): AsyncResult<{ readonly fileName: string }>;
}
export const ExportFileSinkToken = createToken<ExportFileSink>('core.exportFileSink');

/** An asset's original as an interchange file names it (TL4). Never a proxy. */
export interface InterchangeMedia {
  /** Absolute path of the online original (managed copy or watched file in place); null when offline or gone. */
  readonly path: string | null;
  /** The last known path, kept for an offline original (Final Cut relinks it). */
  readonly lastKnownPath: string | null;
  readonly name: string;
  readonly rate: FrameRate | null;
  readonly durationFrames: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly hasAudio: boolean;
  readonly audioChannels: number | null;
  readonly audioRate: number | null;
}

/** The library implements it in the agent process. */
export interface InterchangeMediaSource {
  /** Unknown assets are left out of the map. */
  resolve(assetIds: readonly AssetId[]): AsyncResult<ReadonlyMap<AssetId, InterchangeMedia>>;
}
export const InterchangeMediaSourceToken = createToken<InterchangeMediaSource>('core.interchangeMediaSource');
