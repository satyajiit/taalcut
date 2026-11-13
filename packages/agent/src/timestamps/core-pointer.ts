// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one place a resolved reference becomes core's ReferencePointer (C-19), which run.started logs and the
 * stored user message carries. Its range is a TimeRange in the basis's time (contract round P3-2): rescaled once
 * to the template's or the timeline's canvas rate, nearest frame, so a later seek lands on a frame. With no
 * video to point into (unresolved), it stays what was said, at the typed clock's rate.
 */
import { TimeRange, type ReferencePointer } from '@taalcut/core';
import type { ResolvedReference } from './resolve';

export function toReferencePointer(place: ResolvedReference): ReferencePointer {
  const { said, basis, kind, templateId, timelineId, slotId, slotNumber, clipId, range, rate } = place;
  return {
    said,
    basis,
    kind,
    templateId,
    timelineId,
    slotId,
    slotNumber,
    clipId,
    range: range && rate ? TimeRange.rescale(range, rate) : range,
  };
}
