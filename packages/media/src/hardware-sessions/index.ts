// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  createHardwareSessionGate,
  processAlive,
  type HardwareSessionGate,
  type HardwareSessionGateOptions,
  type HardwareSessionLease,
} from './gate';
export {
  gateHardwareSessions,
  hardwareSessionContext,
  hardwareSessionsFor,
  keepGate,
  releaseWhenExited,
} from './runner';
export { hardwareSessionWeight } from './weight';
export {
  ensurePrivateFolder,
  HARDWARE_SESSION_FOLDER,
  hardwareSessionFolder,
  type SessionFolderHost,
} from './location';
export { helperRequestHold, type HelperRequestHold } from './helper-request';
export { processStart, type ProcessStart } from './process-start';
export {
  DEFAULT_HARDWARE_SESSION_LIMIT,
  ENGINE_SESSION_LIMITS,
  HARDWARE_SESSION_LIMITS,
  HARDWARE_VIDEO_ENGINES,
  hardwareSessionLimit,
  type HardwareSessionProfile,
  type HardwareVideoEngine,
} from './limits';
