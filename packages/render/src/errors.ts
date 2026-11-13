// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's errors (SPEC section 12). Params never hold paths: `name` is a
 * file name, ids are ids. Cancellation is core's CancelledError.
 */
import { defineError } from '@taalcut/core';

/**
 * Core's `render.acknowledgement_required`: nothing in render raises it since
 * REF1 (the reel's music needs no acknowledgement). Kept for stored reports.
 */
export { RenderAcknowledgementRequired as AcknowledgementRequired } from '@taalcut/core';

export const TimelineInvalid = defineError<{ field: string }>('render.timeline_invalid');
export const UnsupportedFrameRate = defineError<{ rate: string }>('render.unsupported_frame_rate');
export const DurationOutOfRange = defineError<{ presetId: string; minSeconds: number; maxSeconds: number }>(
  'render.duration_out_of_range',
);
export const MediaMissing = defineError<{ name: string }>('render.media_missing');
export const FontMissing = defineError<{ font: string }>('render.font_missing');
/** The pinned headless shell is missing or fails its hash. */
export const EngineUnavailable = defineError<{ reason: string }>('render.engine_unavailable');
export const CaptureFailed = defineError('render.capture_failed', { retryable: true });
export const EncodeFailed = defineError('render.encode_failed');
/**
 * LNX1-AV1: an export in a codec this machine has no working encoder for (AV1 or HEVC without a hardware encoder),
 * or one its preset doesn't offer. Nothing rendered.
 */
export const CodecUnavailable = defineError<{ codec: string }>('render.codec_unavailable');
export const DiskFull = defineError<{ neededBytes: number }>('render.disk_full');
export const PreviewSessionExpired = defineError('render.preview_session_expired');
/** Delivery or a media URL asked of a render that isn't ready. */
export const RenderNotReady = defineError<{ status: string }>('render.not_ready');
/** finalizeRender without a passing or overridden QA report (gate criterion 4). */
export const QaNotPassed = defineError<{ verdict: string }>('render.qa_not_passed');
/** render.overrideQa naming a check that may not be overridden, or that isn't failing. */
export const OverrideRefused = defineError<{ check: string }>('render.override_refused');
/** The timeline was edited after the export was asked for: a render is of exactly one revision. */
export const TimelineChanged = defineError<{ expected: number; actual: number }>('render.timeline_changed');
