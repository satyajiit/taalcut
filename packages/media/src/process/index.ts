// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { createProcessRunner, runProcess, type ProcessOutput, type ProcessRunner, type RunOptions } from './runner';
export {
  createEndPolicy,
  DEFAULT_END_POLICY,
  DEFAULT_STALL_AFTER_MS,
  FFMPEG_STOP,
  HELPER_STOP,
  PLAIN_STOP,
  type EndPlan,
  type EndPolicy,
  type EndPolicyOptions,
  type ProcessStall,
  type ProgramStop,
  type RunHolding,
} from './end-policy';
export { SIDECAR_ENV_KEYS, sidecarEnv, type SidecarEnvOptions } from './child-group';
export { watchProcessGroup, type GroupWatchdog } from './group-watchdog';
