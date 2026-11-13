// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The trace and usage shapes the developer trace viewer and Settings → Usage
 * read. Core owns them (its `traces` and `usage` contracts); the library
 * stores validate what they are given against core's schemas.
 */
export {
  SPAN_KINDS,
  SPAN_STATUSES,
  traceGapSchema,
  traceRunSchema,
  traceSpanSchema,
  type SpanKind,
  type SpanStatus,
  type Trace,
  type TraceGap,
  type TraceRunInput,
  type TraceSpan,
  type TraceSummary,
  type UsagePage,
  type UsageTotals,
} from '@taalcut/core';
