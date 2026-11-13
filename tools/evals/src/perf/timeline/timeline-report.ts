// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** timeline.json's shape (IX-B2): what report.ts builds and markdown.ts prints. */
import type { CriticalPath } from './critical-path';
import type { LaneUsage } from './lanes';
import type { LibraryJob } from './library-rows';
import type { AssetMilestones, SearchableRule } from './milestones';
import type { OcrReport } from './ocr-counts';
import type { DecodeReport, FileBusy } from './per-file';
import type { StageSpan } from './spans';

export interface TimelineReport {
  readonly v: 1;
  readonly addedAt: number;
  readonly videoSeconds: number;
  readonly searchableRule: SearchableRule;
  /** Whether the library stored searchable_at (the ready lane), read beside the computed value. */
  readonly searchableStored: boolean;
  readonly searchableMs: number | null;
  readonly searchableMinPerHour: number | null;
  readonly storedSearchableMs: number | null;
  readonly completeMs: number | null;
  readonly completeMinPerHour: number | null;
  /** Whether the library stored complete_at, and the library's line from it. */
  readonly completeStored: boolean;
  readonly storedCompleteMs: number | null;
  /** Descriptions held for their model and left out of complete (milestones.ts `heldForModel`). */
  readonly completeHeldForModel: number;
  /** Assets whose stored and computed lines differ by more than MISMATCH_MS (a ready-lane bug if any). */
  readonly mismatches: readonly {
    readonly file: string;
    readonly line: 'searchable' | 'complete';
    readonly computedMs: number | null;
    readonly storedMs: number | null;
  }[];
  readonly files: readonly FileBusy[];
  /** The decode lane's counters; null before stage outputs carry them. */
  readonly decodes: DecodeReport | null;
  /** The ocr lane's counters; null before stage outputs carry them. */
  readonly ocr: OcrReport | null;
  readonly assets: readonly AssetMilestones[];
  readonly usage: LaneUsage;
  readonly criticalPath: { readonly searchable: CriticalPath | null; readonly complete: CriticalPath | null };
  /** Library-wide jobs (the scan, duplicate grouping), in ms from Add folder. */
  readonly libraryJobs: readonly (Omit<LibraryJob, 'queuedAt' | 'startedAt' | 'finishedAt'> & {
    readonly queuedMs: number;
    readonly startedMs: number | null;
    readonly finishedMs: number | null;
  })[];
  readonly spans: readonly StageSpan[];
}
