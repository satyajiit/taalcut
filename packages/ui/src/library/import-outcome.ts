// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an import's failures and pauses mean, read from its status (UX1-IMPORT). "2 files couldn't be read" was
 * said of every failure, though most stages work on a file that was read fine: only the stages that read the
 * bytes (hashing them, then probing and preparing the file) fail because of the file itself. A failure anywhere
 * else leaves a clip that plays, whose analysis didn't finish. And an import whose clips all wait, with nothing
 * running, isn't busy: it waits for a model download (or for its originals to come back).
 */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { AssetKind, ImportStatus, PublicError } from '@taalcut/core';
import { ERROR_MESSAGES } from '../feedback/error-messages';
import { importStageLabel } from '../cards/import-labels';

/** The stages that read the file itself: a failure there means the file couldn't be read. */
export const READING_STAGES: readonly string[] = ['library.hash', 'media.normalise'];

export interface ImportFailures {
  /** Files that couldn't be read (a reading stage failed; nothing after it ran). */
  readonly unreadable: number;
  /** Clips that came in but whose analysis didn't finish. */
  readonly unanalysed: number;
}

/**
 * The import's failed clips, split by what failed. A file whose reading stage failed runs nothing after it, so
 * each failed asset is counted in one reading stage at most and the rest failed later on.
 */
export function importFailures(status: ImportStatus): ImportFailures {
  const failed = status.counts.failed;
  const reading = status.stages
    .filter((stage) => READING_STAGES.includes(stage.stage))
    .reduce((sum, stage) => sum + stage.failed, 0);
  const unreadable = Math.min(failed, reading);
  return { unreadable, unanalysed: failed - unreadable };
}

/**
 * Work is left but none of it runs: every waiting clip waits for something outside the import (a model to
 * download, an original to come back). The library holds a stage whose model is missing instead of failing it.
 */
export function waitsOnly(status: ImportStatus): boolean {
  const { active, waiting } = status.counts;
  return status.state === 'indexing' && active === 0 && waiting > 0 && status.jobIds.length === 0;
}

/** What an import's model-waiting work is for (UX3-IDX), in the clip page's words: each names one model. */
export type ModelWaitKind = 'text' | 'speech' | 'search' | 'describe' | 'beats';

/** The model kinds in the order the line says them. */
const MODEL_KINDS: readonly ModelWaitKind[] = ['text', 'speech', 'search', 'describe', 'beats'];

/** The steps that embed for search: while one waits, a waiting description waits for the search model too. */
const EMBED_STAGES: ReadonlySet<string> = new Set(['vision.embed', 'vision.embedText', 'vision.embedOcr']);

function modelKindOf(stage: string, embedding: boolean): ModelWaitKind {
  if (stage === 'vision.ocr') return 'text';
  if (stage === 'audio.beats') return 'beats';
  if (stage.startsWith('audio.')) return 'speech';
  // LIB1-PROG, for LIB1-FIX: a description alone waits for the model that describes (Qwen3.5 4B), not search's.
  if (stage === 'vision.describe' && !embedding) return 'describe';
  return 'search';
}

/**
 * The models the import's waiting work waits for, from the stages' `waitingForModel` (the library's held rows):
 * `text` for on-screen text reading (PP-OCR), `speech` for listening (whisper), `search` for the search model
 * (EmbeddingGemma: vectors, and descriptions waiting beside them), `describe` for the model that describes clips (a
 * description waiting alone, LIB1-FIX), `beats` for the beat model. Empty when nothing waits for a model or the
 * status predates the count.
 */
export function modelWaits(status: ImportStatus): ModelWaitKind[] {
  const held = status.stages.filter((stage) => (stage.waitingForModel ?? 0) > 0);
  const embedding = held.some((stage) => EMBED_STAGES.has(stage.stage));
  const kinds = new Set(held.map((stage) => modelKindOf(stage.stage, embedding)));
  return MODEL_KINDS.filter((kind) => kinds.has(kind));
}

/** The import ended with files that failed (not a stopped scan, which has none). */
export function endedWithFailures(status: ImportStatus): boolean {
  return status.state === 'failed' && status.counts.failed > 0;
}

/** One kind when every failed file is of it (the line says "videos"), else null ("files"). */
export function onlyKind(kinds: Readonly<Partial<Record<AssetKind, number>>> | undefined): AssetKind | null {
  const present = KINDS.filter((kind) => (kinds?.[kind] ?? 0) > 0);
  return present.length === 1 ? (present[0] ?? null) : null;
}

/** core's ASSET_KINDS, restated: ui imports only types from core. */
const KINDS: readonly AssetKind[] = ['video', 'image', 'audio', 'live_photo'];

const UNREAD = msg`Taalcut couldn’t read this file. It may be damaged or only partly copied.`;

/**
 * Why one file failed, in words: its error's when the catalogue has them (the renderer adds media's, which
 * indexing sends), else what failed: the file couldn't be read, or the stage that didn't finish.
 */
export function failureReason(i18n: I18n, stage: string, error: PublicError | undefined): string {
  const known = error
    ? (ERROR_MESSAGES[error.messageKey] ?? (error.messageKey in i18n.messages ? error.messageKey : null))
    : null;
  if (known !== null && error) {
    return typeof known === 'string'
      ? i18n._(known, error.params)
      : i18n._({ ...known, values: error.params });
  }
  if (READING_STAGES.includes(stage)) return i18n._(UNREAD);
  const step = importStageLabel(i18n, stage);
  return i18n._(msg`“${step}” didn’t finish. The clip plays as usual.`);
}
