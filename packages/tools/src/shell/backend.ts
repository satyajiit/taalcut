// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the workspace shell's command is confined (AGT2 sbx): Seatbelt on macOS (`sandbox-exec` with workspace.sb),
 * bubblewrap on Linux (the distribution's `bwrap`, with a seccomp filter). Either way the child always runs as
 *
 *   /bin/sh -c '<constant script>' shell <cpu> <fileBlocks> <openFiles> <processes> <launcher…> /bin/sh -c <command>
 *
 * The constant script only sets the limits and `exec`s the rest, so no shell parses an argument before the
 * confined one, which parses the agent's command inside the sandbox.
 */

export type ShellBackend =
  | {
      readonly kind: 'seatbelt';
      readonly sandboxExec: string;
      readonly profile: string;
      /** `-D NAME=value` params, in order. */
      readonly params: readonly (readonly [string, string])[];
    }
  | {
      readonly kind: 'bwrap';
      readonly bwrap: string;
      /** bwrap's options, before `--`. */
      readonly args: readonly string[];
      /** Kept open for bwrap's `--seccomp 3`: the filter's bytes, as the child's fd 3. */
      readonly seccomp?: Uint8Array;
    };

/**
 * Sets the limits, then replaces itself with the rest of its arguments. Never interpolated. The open-file and
 * process limits are best effort (a hard limit below them leaves the system's); CPU time and file size always hold.
 * bash (macOS's sh) names the process limit -u, dash (Debian's and Ubuntu's) -p.
 */
export const SHELL_WRAPPER =
  'ulimit -t "$1" && ulimit -f "$2" && { ulimit -n "$3" 2>/dev/null || :; } && ' +
  '{ ulimit -u "$4" 2>/dev/null || ulimit -p "$4" 2>/dev/null || :; } && shift 4 && exec "$@"';

/** The launcher and the confined shell: what the wrapper `exec`s. */
export function confinedArgv(backend: ShellBackend, command: string): string[] {
  if (backend.kind === 'seatbelt') {
    const defines = backend.params.flatMap(([name, value]) => ['-D', `${name}=${value}`]);
    return [backend.sandboxExec, '-f', backend.profile, ...defines, '/bin/sh', '-c', command];
  }
  return [backend.bwrap, ...backend.args, '--', '/bin/sh', '-c', command];
}

export interface WrapperLimits {
  readonly cpuSeconds: number;
  readonly maxFileBytes: number;
  readonly openFiles: number;
  /** The `ulimit -u` value: this user's processes now plus what the tree may add. */
  readonly processCap: number;
  /** How many bytes the wrapper's `sh` counts in a `ulimit -f` block: 1024 for bash (macOS), 512 for dash. */
  readonly fileBlockBytes: number;
}

/** `/bin/sh`'s argv for the wrapper. */
export function wrapperArgv(limits: WrapperLimits, confined: readonly string[]): string[] {
  return [
    '-c',
    SHELL_WRAPPER,
    'shell',
    String(Math.max(1, Math.ceil(limits.cpuSeconds))),
    String(Math.max(1, Math.ceil(limits.maxFileBytes / limits.fileBlockBytes))),
    String(Math.max(64, Math.floor(limits.openFiles))),
    String(Math.max(16, Math.floor(limits.processCap))),
    ...confined,
  ];
}
