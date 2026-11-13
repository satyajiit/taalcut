// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Final Cut Pro writer (P3-V5): FCPXML 1.14 (Final Cut Pro 12.0), written directly with no dependency, as a
 * registered TimelineExporter. One library, one event, one project whose sequence is the canvas (1080 × 1920 at
 * its rate, non-drop-frame: Taalcut has no drop-frame timelines), V1 as the spine and the audio connected below.
 * Burned-in captions are render's SRT and VTT, offered beside the file, not markers here.
 */
import { ok, type Timeline } from '@taalcut/core';
import { defineExporter, type InterchangeContext } from '../exporter';
import { interchangeWarnings } from '../warnings';
import { fcpxmlCutList } from './read-back';
import { buildResources } from './resources';
import { buildSpine, sequenceDuration } from './spine';
import { connectedAudio, timedMarkers } from './story-items';
import { fcpTime } from './time';
import { element, serializeXml } from './xml';

/** The FCPXML version written; `version` is #FIXED in each DTD, so this is the one place it changes. */
export const FCPXML_VERSION = '1.14';
const WRITER_VERSION = '1.0.0';

/** Switched by the manual Final Cut check (SPEC, P3-V5): transitions stay cuts plus markers until then. */
export const FCPXML_CONFIG = { transitions: 'marker' } as const;

export function writeFcpxml(timeline: Timeline, context: InterchangeContext): string {
  const resources = buildResources(timeline, context);
  const markers = timedMarkers(timeline, FCPXML_CONFIG.transitions === 'marker');
  const spine = buildSpine(timeline, resources, markers, connectedAudio(timeline));
  const sequence = element(
    'sequence',
    {
      format: resources.sequenceFormat,
      duration: sequenceDuration(timeline),
      tcStart: fcpTime({ num: 0n, den: 1n }),
      tcFormat: 'NDF',
      audioLayout: 'stereo',
      audioRate: '48k',
    },
    [spine],
  );
  const project = element('project', { name: timeline.name }, [sequence]);
  const library = element('library', {}, [element('event', { name: 'Taalcut' }, [project])]);
  const root = element('fcpxml', { version: FCPXML_VERSION }, [
    element('resources', {}, resources.nodes),
    library,
  ]);
  return serializeXml(root, 'fcpxml');
}

export const fcpxmlExporter = defineExporter({
  id: 'fcpxml',
  formatVersion: FCPXML_VERSION,
  writerVersion: WRITER_VERSION,
  fileExtension: '.fcpxml',
  mediaType: 'application/xml',
  labelKey: 'interchange.fcpxml.label',
  write(timeline: Timeline, context: InterchangeContext) {
    const text = writeFcpxml(timeline, context);
    const cuts = fcpxmlCutList(text);
    if (!cuts.ok) return cuts;
    return ok({
      text,
      cutList: cuts.value,
      warnings: interchangeWarnings(timeline, context, {
        transitionsAsCuts: FCPXML_CONFIG.transitions === 'marker',
      }),
    });
  },
});
