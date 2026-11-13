// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors @taalcut/vision declares. Media and model errors pass through unchanged. */
import { defineError } from '@taalcut/core';

/**
 * The tool was registered for on-device models only (no upload consent in its
 * metadata) but the vision chain now has no local model. Nothing was sent.
 */
export const NoLocalVisionModel = defineError('vision.no_local_model');

/** The model answered with no text. Trying again usually works. */
export const EmptyDescription = defineError<{ model: string }>('vision.empty_description', {
  retryable: true,
});

/** No OCR engine here reads this language (Apple Vision doesn't list it, and no PP-OCR model does). */
export const OcrUnavailable = defineError<{ language: string }>('vision.ocr_unavailable');

/**
 * An on-device model or runtime a vision stage needs isn't installed yet (UX3-IDX: PP-OCR's Latin or Devanagari
 * model, or ONNX Runtime under it). Not the file's fault: the library holds the stage until the component is
 * installed (its `<package>.model_missing` rule), and the asset page names `component`.
 */
export const VisionModelMissing = defineError<{ component: string }>('vision.model_missing');

/** The OCR engine failed on a frame (the helper crashed, the session failed). Usually transient. */
export const OcrFailed = defineError('vision.ocr_failed', { retryable: true });

/** The embedding model can't be loaded: the component isn't installed or the runtime is missing. */
export const EmbedderUnavailable = defineError('vision.embedder_unavailable');

/** The embedding model failed on a batch. Usually transient (GPU memory, a cancelled sibling). */
export const EmbeddingFailed = defineError('vision.embedding_failed', { retryable: true });

/** The vector index belongs to another embedding space (model, revision or width). Never mixed. */
export const SpaceMismatch = defineError<{ expected: string; actual: string }>('vision.space_mismatch');

/**
 * The shot-boundary model (TransNetV2) isn't installed, didn't load, failed on a window, or its own process
 * didn't start or was lost: shots fall back to scdet and the embedding check (IX2-C4, IX2-S2). Usually not worth
 * a retry; the fallback already ran.
 */
export const ShotModelFailed = defineError('vision.shot_model_failed');

/**
 * The no-helper subject detector (RTMO-s and YOLOX-Nano on ONNX Runtime, FRM1-SUB) failed: a session wouldn't open, a
 * run failed, the graph isn't the one expected, or the frame isn't RGB24 of its size. A missing component is
 * `vision.model_missing` instead. Usually transient (GPU memory, a lost device).
 */
export const SubjectDetectFailed = defineError('vision.subject_detect_failed', { retryable: true });

/** The vision model's JSON failed its schema. Worth one more try. */
export const ModelOutputInvalid = defineError('vision.model_output_invalid', { retryable: true });

export { GradeFailed, LookUnavailable } from './look/errors';
export { FontMatchWithheld, FontRenderFailed } from './fonts/errors';
