// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A pro export writer (P3-V5): one module per format, registered in catalog.ts. A writer turns a timeline and
 * its resolved originals into the file's text, reads its own text back to a cut list (what the file means to
 * another editor) and lists what that editor won't get exactly as Taalcut plays it.
 */
import {
  INTERCHANGE_FORMATS,
  err,
  ValidationError,
  type AssetId,
  type InterchangeFormat,
  type InterchangeMedia,
  type InterchangePathStyle,
  type InterchangeWarning,
  type Result,
  type Timeline,
} from '@taalcut/core';
import type { CutList } from './cut-list';

export interface InterchangeContext {
  /** Every asset the timeline names that the library knows; a missing one is written offline. */
  readonly media: ReadonlyMap<AssetId, InterchangeMedia>;
  /** How media paths are written where the format allows a choice (OTIO); FCPXML always takes file URLs. */
  readonly pathStyle: InterchangePathStyle;
}

export interface InterchangeDocument {
  readonly text: string;
  /** The writer's own file read back: every cut and in-point as another editor will see them. */
  readonly cutList: CutList;
  readonly warnings: readonly InterchangeWarning[];
}

export interface TimelineExporter {
  readonly id: InterchangeFormat;
  /** The format's own version, written in the file (OTIO '0.18.1', FCPXML '1.14'). */
  readonly formatVersion: string;
  /** The writer's semver, in the file's metadata. */
  readonly writerVersion: string;
  readonly fileExtension: string;
  readonly mediaType: string;
  /** The export dialog's label, e.g. `interchange.otio.label`. */
  readonly labelKey: string;
  write(timeline: Timeline, context: InterchangeContext): Result<InterchangeDocument>;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const EXTENSION = /^\.[a-z0-9]+$/;

/** Checks a writer's declaration once, at registration: a bad one is a wiring bug and throws. */
export function defineExporter(exporter: TimelineExporter): TimelineExporter {
  const problems = [
    (INTERCHANGE_FORMATS as readonly string[]).includes(exporter.id)
      ? null
      : `unknown format '${exporter.id}'`,
    SEMVER.test(exporter.writerVersion) ? null : `writerVersion '${exporter.writerVersion}' is not semver`,
    exporter.formatVersion.trim() ? null : 'no formatVersion',
    EXTENSION.test(exporter.fileExtension) ? null : `bad file extension '${exporter.fileExtension}'`,
    exporter.mediaType.includes('/') ? null : `bad media type '${exporter.mediaType}'`,
    exporter.labelKey.trim() ? null : 'no labelKey',
  ].filter((problem) => problem !== null);
  if (problems.length > 0) throw new Error(`Interchange writer ${exporter.id}: ${problems.join('; ')}`);
  return { ...exporter, write(timeline, context) {
    if (timeline.tracks.some((track) => track.kind === 'video' && track.items.some((item) => item.type === 'program')))
      return err(ValidationError({ field: 'interchange' }, { detail: 'Authored programs stay editable in Taalcut. Render video before exporting to another editor.' }));
    return exporter.write(timeline, context);
  } };
}
