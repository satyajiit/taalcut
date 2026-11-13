// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The models and processes job kinds share (core's `JobKind.lane`, round IX design A), with how many of a
 * lane's jobs run at once. One job per lane by default: each lane is one loaded model with one queue of work,
 * and a second job of a lane would only wait inside it while holding a class slot. A profile raises a lane only
 * where a second job does work of its own beside the first (`APPLE_TIER_LANES`: on-screen text, IX3-O2).
 */

export const MODEL_LANES = [
  /** EmbeddingGemma 2 (frame and text vectors). The embedder runs one batch at a time; queries jump ahead. */
  'vision.embedder',
  /** whisper.cpp: language ID and whisper transcripts. */
  'audio.whisper',
  /** Parakeet on the Neural Engine (Core ML). */
  'audio.parakeet',
  /** Beat This! (beat and downbeat tracking). */
  'audio.beats',
  /** The local llama.cpp server for descriptions: one slot (vision index-kinds.ts). */
  'models.llm',
  /**
   * On-screen text (design H): Apple Vision through the mac helper, PP-OCR through ONNX Runtime on Windows. The
   * `vision.ocr` stage's kind (`vision.readShotText`, class npu) runs here, so it overlaps the embedder instead of
   * queuing behind it; the class budgets keep it a slot (profiles.ts).
   */
  'vision.ocr',
] as const;

export type ModelLane = (typeof MODEL_LANES)[number];

export const MODEL_LANE_LIMITS: Readonly<Record<ModelLane, number>> = {
  'vision.embedder': 1,
  'audio.whisper': 1,
  'audio.parakeet': 1,
  'audio.beats': 1,
  'models.llm': 1,
  'vision.ocr': 1,
};
