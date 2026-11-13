// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One pro export (P3-V5): resolve the originals, run the format's writer, check that its file reads back to
 * the timeline's own cut list (any difference is a bug and nothing is written), then hand the text to the
 * agent process's ExportFileSink, which stores it in Taalcut's exports folder under a safe, unique name.
 */
import {
  err,
  ok,
  type AsyncResult,
  type ExportFileSink,
  type InterchangeExportResult,
  type InterchangeFormat,
  type InterchangeMediaSource,
  type InterchangePathStyle,
  type Timeline,
} from '@taalcut/core';
import { InterchangeMismatch } from '../errors';
import { cutDifferences, cutList } from './cut-list';
import { timelineAssets } from './media-paths';
import type { ExporterRegistry } from './registry';

export interface InterchangeDeps {
  readonly exporters: ExporterRegistry;
  /** The library's originals (core TL4). */
  readonly media: InterchangeMediaSource;
  /** Taalcut's exports folder (the desktop's, in the agent process). */
  readonly files: ExportFileSink;
}

/** The result lists at most this many warnings (core's interchangeExportResultSchema). */
const MAX_WARNINGS = 500;

export async function exportInterchange(
  deps: InterchangeDeps,
  timeline: Timeline,
  format: InterchangeFormat,
  pathStyle: InterchangePathStyle,
): AsyncResult<InterchangeExportResult> {
  const exporter = deps.exporters.get(format);
  if (!exporter.ok) return exporter;
  const media = await deps.media.resolve(timelineAssets(timeline));
  if (!media.ok) return media;
  const document = exporter.value.write(timeline, { media: media.value, pathStyle });
  if (!document.ok) return document;
  const differences = cutDifferences(cutList(timeline), document.value.cutList);
  if (differences.length > 0)
    return err(
      InterchangeMismatch(undefined, { detail: `${format}: ${differences.slice(0, 3).join('; ')}` }),
    );
  const written = await deps.files.write({
    projectId: timeline.projectId,
    baseName: timeline.name,
    extension: exporter.value.fileExtension,
    text: document.value.text,
  });
  if (!written.ok) return written;
  return ok({ fileName: written.value.fileName, warnings: document.value.warnings.slice(0, MAX_WARNINGS) });
}
