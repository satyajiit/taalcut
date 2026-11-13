// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which stage failures are not the file's fault (UX1-IMPORT). A job that fails because its on-device model or
 * component isn't installed yet (`audio.model_missing` naming whisper-tiny, `asr.model_missing`: every package
 * names that error `<package>.model_missing`) says nothing about the clip: it was read, and one kind of analysis
 * waits for a download. Counting it as a failed file made a phone import of two good videos read "2 files
 * couldn't be read". Such a row is *held* instead: `waiting` with `library.stage.modelMissing`, the error kept so
 * the asset page can name the model (model-wait.ts schedules it).
 */

/** The reason a held row waits with (stage-rows.ts MODEL_MISSING; restated here so the two files don't cycle). */
export const MODEL_MISSING_REASON = 'library.stage.modelMissing';

/** The failure is a missing on-device model or component, not a problem with the file. */
export function isModelMissing(error: { readonly code: string }): boolean {
  return error.code.endsWith('.model_missing');
}

/**
 * SQL: row `x` is held (waiting for its model after its job said the model is missing). One `?`: the reason.
 * Null-safe (`IS`), so `NOT ${HELD}` keeps every other row, a waiting row without a reason included.
 */
export const HELD = `(x.state = 'waiting' AND x.reason_key IS ? AND x.error IS NOT NULL)`;

/**
 * SQL: row `b` won't run until its model is there (LRN1-CTX): held (its own job said the model is missing) or
 * waiting behind its stage's held rows or its stage's missing model, which `markBlocked` marks with the same reason
 * and no error. One `?`: the reason. Wider than HELD on purpose: on a stage waiting for its model only one row is
 * ever tried (model-wait.ts), so the rest of its rows are never held themselves, yet none of them can come before
 * the model does. An optional read in this state is not waited for (stage-rows.ts `runnable`).
 */
export const WAITS_FOR_MODEL = `(b.state = 'waiting' AND b.reason_key IS ?)`;
