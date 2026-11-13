// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The registered pro export writers, by format: what the command writes with and the dialog offers. */
import { err, ok, type InterchangeFormatInfo, type Result } from '@taalcut/core';
import { InterchangeFormatUnknown } from '../errors';
import { defineExporter, type TimelineExporter } from './exporter';

export interface ExporterRegistry {
  get(format: string): Result<TimelineExporter>;
  /** For `timelines.interchangeFormats`, in registration order. */
  list(): InterchangeFormatInfo[];
}

/** A duplicate format or a bad declaration is a wiring bug and throws. */
export function createExporterRegistry(exporters: readonly TimelineExporter[]): ExporterRegistry {
  const byId = new Map<string, TimelineExporter>();
  for (const exporter of exporters) {
    if (byId.has(exporter.id)) throw new Error(`Interchange writer ${exporter.id} is registered twice`);
    byId.set(exporter.id, defineExporter(exporter));
  }
  return {
    get(format) {
      const exporter = byId.get(format);
      return exporter ? ok(exporter) : err(InterchangeFormatUnknown({ format }));
    },
    list: () =>
      [...byId.values()].map((exporter) => ({
        id: exporter.id,
        version: exporter.formatVersion,
        fileExtension: exporter.fileExtension,
        labelKey: exporter.labelKey,
      })),
  };
}
