// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** DSG1-READ: a reel's graphics read as design, with a vision model and the measured facts. */
export { readGraphicAnswer, type GraphicAnswer } from './answer';
export { colourWords } from './colour-words';
export { composeBriefs, speakersOf, type BriefInput } from './compose';
export {
  graphicFacts,
  lookWords,
  reelOfDraft,
  reelOfTemplate,
  type GraphicFacts,
  type GraphicReel,
} from './facts';
export {
  GRAPHIC_BRIEF_MAX_TOKENS,
  GRAPHIC_BRIEF_PROMPT,
  GRAPHIC_BRIEF_SYSTEM,
  graphicQuestion,
} from './prompt';
export {
  GRAPHIC_READ_BUDGET_MS,
  GRAPHICS_FILE,
  promptOverlays,
  readGraphics,
  readGraphicsFile,
  type GraphicContent,
  type GraphicModel,
  type GraphicModelAnswer,
  type GraphicModelRequest,
  type GraphicsFile,
  type ReadGraphicsResult,
} from './read';
export { graphicReading, withGraphicReading } from './reading';
export { textRecord, type TextRecord } from './record';
export { graphicSystem } from './system';
