// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V5: writers register themselves; a duplicate format or a bad declaration is refused at wiring time. */
import { describe, expect, it } from 'vitest';
import { EXPORTERS, defaultExporterRegistry } from '../../src/interchange/catalog';
import { defineExporter, type TimelineExporter } from '../../src/interchange/exporter';
import { createExporterRegistry } from '../../src/interchange/registry';

const [otio] = EXPORTERS;

describe('exporter registry', () => {
  it('registers both writers and lists them for the export dialog', () => {
    expect(defaultExporterRegistry().list()).toEqual([
      { id: 'otio', version: '0.18.1', fileExtension: '.otio', labelKey: 'interchange.otio.label' },
      { id: 'fcpxml', version: '1.14', fileExtension: '.fcpxml', labelKey: 'interchange.fcpxml.label' },
    ]);
  });

  it('answers an unknown format with timeline.interchange_format_unknown', () => {
    const found = defaultExporterRegistry().get('aaf');
    expect(!found.ok && found.error).toMatchObject({
      code: 'timeline.interchange_format_unknown',
      params: { format: 'aaf' },
    });
  });

  it('refuses a duplicate format and a bad declaration', () => {
    expect(() => createExporterRegistry([otio, otio])).toThrow(/registered twice/);
    const bad: TimelineExporter = { ...otio, writerVersion: 'one', fileExtension: 'otio' };
    expect(() => defineExporter(bad)).toThrow(/writerVersion 'one' is not semver; bad file extension 'otio'/);
    expect(() => defineExporter({ ...otio, id: 'aaf' as TimelineExporter['id'] })).toThrow(
      /unknown format 'aaf'/,
    );
  });
});
