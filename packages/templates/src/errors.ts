// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates package's errors (SPEC "Errors"). Params never hold paths or
 * URLs; those go in `detail`, which only developers see.
 */
import { defineError } from '@taalcut/core';

/** Not a Shorts, Reels or TikTok link over https. */
export const UnsupportedLink = defineError('templates.unsupported_link');
/**
 * yt-dlp failed; detail has its exit code and last warning. Sites break, so a retry may help. An Instagram reel the
 * fetch could get only signed in, with no session to try, is core's `templates.instagram_auth_required` instead.
 */
export const FetchFailed = defineError('templates.fetch_failed', { retryable: true });
/** No fetcher for this Mac (the component isn't in the manifest, or can't install). */
export const FetchUnavailable = defineError('templates.fetch_unavailable');
export const ReferenceTooLong = defineError<{ seconds: number }>('templates.reference_too_long');
export const NoVideo = defineError('templates.no_video');
/** templates.fetchMedia on a template with no link to fetch its reel from (a format, a file, a hub template). */
export const NoOriginLink = defineError('templates.no_origin_link');
/** The breakdown's scratch folder was discarded or swept. */
export const ExperimentGone = defineError('templates.experiment_gone');
export const BreakdownNotFound = defineError('templates.breakdown_not_found');
/** Stored with a newer schemaVersion than this build knows. Never guessed at. */
export const UnsupportedSchema = defineError<{ schemaVersion: number }>('templates.unsupported_schema');
export const SlotNotFound = defineError('templates.slot_not_found');
export const SlotsNotAdjacent = defineError('templates.slots_not_adjacent');
export const LastSlot = defineError('templates.last_slot');
/** The agent may not rewrite an intent the user approved. */
export const SlotApproved = defineError('templates.slot_approved');
export const TemplateInUse = defineError<{ timelines: number }>('templates.in_use');
export const FormatTarget = defineError<{ min: number; max: number }>('templates.format_target');
/** A tag that is not 1–32 letters, marks, digits and hyphens after normalisation. */
export const TagInvalid = defineError<{ tag: string }>('templates.tag_invalid');
export const FolderNotFound = defineError('templates.folder_not_found');
export const FolderNameTaken = defineError('templates.folder_name_taken');
export const StyleNotFound = defineError('templates.style_not_found');
/** A timeline or a template version still names the Style. */
export const StyleInUse = defineError<{ timelines: number; templates: number }>('templates.style_in_use');
export const StyleImageInvalid = defineError<{ reason: 'type' | 'size' | 'pixels' }>(
  'templates.style_image_invalid',
);
/**
 * One file in a batch failed; `file` is its index and nothing was imported.
 * `problems` is JSON of `{ path, rule }[]` because error params are scalars.
 */
export const ImportInvalid = defineError<{ file: number; problems: string }>('templates.import_invalid');
export const StarterNotFound = defineError('templates.starter_not_found');
export const NoBeatMap = defineError('templates.no_beat_map');
export const EnergyCurveInvalid = defineError<{ reason: string }>('templates.energy_curve_invalid');
