// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell (AGT2 sbx): a real shell in the agent's HFW1 workspace, confined by the OS (Seatbelt's
 * workspace.sb on macOS, bubblewrap on Linux). Its tools join render's `workspace` module in the composition root.
 */
import type { ToolSpec } from '@taalcut/core';
import { workspaceExecTool } from './exec-tool';
import { workspaceFilesTool, workspaceOpenTool } from './folder-tools';
import { workspaceImportTool } from './import-media';
import type { ShellToolDeps } from './tool-deps';

/** The shell's tools by name (none reuses a name of HFW1's workspace tools). */
export const WORKSPACE_SHELL_TOOLS = [
  'workspace.open',
  'workspace.exec',
  'workspace.files',
  'workspace.importMedia',
] as const;

/** The tools, for the `workspace` module (desktop composes them with render's). */
export function workspaceShellTools(deps: ShellToolDeps): ToolSpec[] {
  return [
    workspaceOpenTool(deps),
    workspaceExecTool(deps),
    workspaceFilesTool(deps),
    workspaceImportTool(),
  ] as unknown as ToolSpec[];
}

export { SHELL_WRAPPER, type ShellBackend } from './backend';
export { BWRAP_PATH, bwrapArgs, bwrapBackend, type BwrapHost } from './bwrap';
export { bwrapBackendFor, probeBwrapHost, type BwrapProbe } from './bwrap-host';
export { freeLoopbackPorts, SHELL_PORTS, SHELL_PORTS_ENV } from './loopback';
export { shellSeccompFilter } from './seccomp';
export {
  ensureShellFolder,
  NO_TOOLCHAIN as NO_SHELL_TOOLCHAIN,
  SHELL_DIRS,
  SHELL_MANIFEST,
  SHELL_ROOT_DIR,
  shellFolderOf,
  type ShellToolchain,
} from './folder';
export { shellRequestSchema, shellRunResultSchema, workspaceShellJob } from './job';
export { shellLimits, SHELL_DEFAULT_WALL_MS, SHELL_MAX_WALL_MS, type ShellLimits } from './limits';
export {
  mediaTypeOf,
  WORKSPACE_IMPORT_COMMAND,
  workspaceImportCommand,
  workspaceImportPayloadSchema,
  type ImportMediaDeps,
} from './import-media';
export { SHELL_STOPS, type ShellRunResult, type ShellStop } from './run-shell';
export { WORKSPACE_PROFILE } from './seatbelt';
export {
  createShellJobs,
  createShellRunner,
  defaultBackend,
  type BackendFor,
  type ExecShellRunnerOptions,
  type ShellCommandRequest,
  type ShellRunner,
} from './shell-runner';
export type { ShellToolDeps } from './tool-deps';
export {
  createToolchainJobs,
  toolchainReportSchema,
  workspaceToolchainJob,
  type ToolchainReport,
  type ToolchainSource,
} from './toolchain-job';
export {
  assembleToolchain,
  WORKSPACE_TOOLCHAIN,
  WORKSPACE_TOOLCHAIN_COMPONENTS,
  type ToolchainPart,
  type ToolchainParts,
} from './toolchain';
