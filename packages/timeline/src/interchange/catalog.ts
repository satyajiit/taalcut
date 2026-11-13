// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pro export writers this build ships (P3-V5). A new format is a new writer module and one line here; the
 * command, the tool and `timelines.interchangeFormats` read the registry and never change.
 */
import { fcpxmlExporter } from './fcpxml/fcpxml-exporter';
import { otioExporter } from './otio/otio-exporter';
import { createExporterRegistry, type ExporterRegistry } from './registry';

export const EXPORTERS = [otioExporter, fcpxmlExporter] as const;

export const defaultExporterRegistry = (): ExporterRegistry => createExporterRegistry(EXPORTERS);
