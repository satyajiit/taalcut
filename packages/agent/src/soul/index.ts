// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Soul v1 (P3-B15, SPEC section 22): SOUL.md v1, the dials, the frozen tone set and its lock. */
export { dialBlock, dialStop, personaParts, runSoul } from './dials';
export { createSoulCommands, SOUL_DIAL_SOURCES, type SoulCommandDeps } from './soul-commands';
export {
  parseSoulText,
  readSoul,
  SOUL_DIALS,
  STOPS_PER_DIAL,
  type DialStop,
  type SoulDial,
  type SoulStops,
} from './soul-file';
export { SOUL_TOOL, soulToolModule } from './soul-tools';
export {
  loadTonePromptSet,
  loadToneRecording,
  promptSetProblems,
  readTonePromptSet,
  textSha256,
  toneLockProblems,
  toneLockSchema,
  TONE_LOCK_PATH,
  TONE_PROMPTS_PATH,
  TONE_RECORDING_PATH,
  type ToneLock,
  type ToneLockEntry,
} from './tone-set';
