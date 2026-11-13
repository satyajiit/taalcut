// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The OpenTimelineIO writer (P3-V5) as a registered TimelineExporter: `.otio` for Resolve and Premiere. */
import { ok, type Timeline } from '@taalcut/core';
import { defineExporter, type InterchangeContext } from '../exporter';
import { writtenMedia } from '../media-paths';
import { interchangeWarnings } from '../warnings';
import { serializeOtio, toOtio, type OtioOptions } from './otio-writer';
import { otioCutList, readOtio } from './read-back';

/** The OTIO release the writer targets; its objects are the 0.18.1 serialized schema. */
export const OTIO_VERSION = '0.18.1';
const WRITER_VERSION = '1.0.0';

/** Switched by the manual Resolve check (SPEC, P3-V5): transitions stay cuts plus markers until then. */
export const OTIO_CONFIG: Required<Pick<OtioOptions, 'transitions'>> = { transitions: 'marker' };

export const otioExporter = defineExporter({
  id: 'otio',
  formatVersion: OTIO_VERSION,
  writerVersion: WRITER_VERSION,
  fileExtension: '.otio',
  mediaType: 'application/vnd.opentimelineio+json',
  labelKey: 'interchange.otio.label',
  write(timeline: Timeline, context: InterchangeContext) {
    const otio = toOtio(
      timeline,
      (assetId) => {
        const media = writtenMedia(assetId, context.media, context.pathStyle);
        return media.offline
          ? { url: null, name: media.name, lastKnown: media.target }
          : { url: media.target, name: media.name };
      },
      { transitions: OTIO_CONFIG.transitions, writer: { id: 'otio', version: WRITER_VERSION } },
    );
    if (!otio.ok) return otio;
    const text = serializeOtio(otio.value);
    const read = readOtio(text);
    if (!read.ok) return read;
    return ok({
      text,
      cutList: otioCutList(read.value),
      warnings: interchangeWarnings(timeline, context, {
        transitionsAsCuts: OTIO_CONFIG.transitions === 'marker',
      }),
    });
  },
});
