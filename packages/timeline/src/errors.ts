// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors the timeline package returns (SPEC, "Errors"). Revision races are core.conflict. */
import { defineError } from '@taalcut/core';

export const TimelineNotFound = defineError<{ timelineId: string }>('timeline.not_found');
export const ItemNotFound = defineError<{ itemId: string }>('timeline.item_not_found');
/** An agent-sourced edit touched a clip the user locked on the cast board. */
export const ClipLocked = defineError<{ clipId: string }>('timeline.clip_locked');
export const MediaTooShort = defineError<{ clipId: string }>('timeline.media_too_short');
/** The asset was deleted or its original is offline. */
export const MediaMissing = defineError<{ assetId: string }>('timeline.media_missing');
/** The edit would leave the document invalid (a clip under one frame, a caption past the end, …). */
export const InvalidMove = defineError('timeline.invalid_move');
export const UnsupportedSchema = defineError<{ schemaVersion: number }>('timeline.unsupported_schema');
/** No slot of the template could be filled from the library. */
export const NoCandidates = defineError('timeline.no_candidates');
export const TemplateNotFound = defineError<{ templateId: string }>('timeline.template_not_found');

// Phase 3 (SPEC "Errors (Phase 3)"). Shortfalls and warnings are results, not errors.
/** No registered writer for this pro export format. */
export const InterchangeFormatUnknown = defineError<{ format: string }>('timeline.interchange_format_unknown');
/** A writer's file reads back to other cuts than the timeline's: a bug, never the user's fault. */
export const InterchangeMismatch = defineError('timeline.interchange_mismatch');
/** The caption axis or a caption preset needs captions the timeline doesn't have. */
export const NoCaptions = defineError('timeline.no_captions');
/** Not one variant could be made on any asked axis. */
export const VariantsNone = defineError('timeline.variants_none');
export const GapNotFound = defineError<{ gapId: string }>('timeline.gap_not_found');
/** The item named as a gap is a clip (or the other way round for a fill). */
export const NotAGap = defineError<{ itemId: string }>('timeline.not_a_gap');
/** No clip of the timeline has a speech analysis to clean up. */
export const CleanupNoSpeech = defineError('timeline.cleanup_no_speech');
/** The cleanup plan was made on another revision of the timeline. */
export const CleanupStale = defineError<{ revision: number }>('timeline.cleanup_stale');
export const StyleNotFound = defineError<{ styleId: string }>('timeline.style_not_found');
