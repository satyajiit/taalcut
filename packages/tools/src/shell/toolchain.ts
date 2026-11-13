// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's toolchain (AGT2 sbx): what is on its PATH, from where. Each runtime is a component
 * (tools/components, manifest.workspace.provisional.json), pinned and hashed, installed on first use by the
 * component manager; FFmpeg and ffprobe are the app's own, and chrome-headless-shell is render's component.
 *
 *   workspace-node      Node 24 (nodejs.org's darwin-arm64 build)          <dir>/bin/node
 *   workspace-python    CPython 3.14 with NumPy and Pillow                 <dir>/python/bin/python3
 *   hyperframes-cli     the HyperFrames CLI and its node_modules, on Node   <dir>/bin/hyperframes
 *
 * The shell may read and run each folder (workspace.sb's TOOLS_n, bwrap's read-only binds), never write it.
 */
import { dirname } from 'node:path';
import type { ShellToolchain } from './folder';

export interface ToolchainComponent {
  readonly componentId: string;
  /** The folder put on PATH, inside the component's. */
  readonly bin: string;
  /** What the agent calls it. */
  readonly program: string;
}

export const WORKSPACE_TOOLCHAIN = {
  node: { componentId: 'workspace-node', bin: 'bin', program: 'node' },
  python: { componentId: 'workspace-python', bin: 'python/bin', program: 'python3' },
  hyperframes: { componentId: 'hyperframes-cli', bin: 'bin', program: 'hyperframes' },
} as const satisfies Record<string, ToolchainComponent>;

export type ToolchainPart = keyof typeof WORKSPACE_TOOLCHAIN;

/** The component ids the shell installs on first use, in order (the CLI runs on the Node component). */
export const WORKSPACE_TOOLCHAIN_COMPONENTS: readonly string[] = Object.values(WORKSPACE_TOOLCHAIN).map(
  (part) => part.componentId,
);

export interface ToolchainParts {
  /** The folder holding ffmpeg and ffprobe. */
  readonly ffmpegDir?: string;
  /** The folder the shell may read for FFmpeg (Linux's bin/ and lib/ under it). Default: ffmpegDir. */
  readonly ffmpegRoot?: string;
  readonly ffmpegVersion?: string;
  /** chrome-headless-shell's executable. */
  readonly headlessShell?: string;
  readonly headlessShellVersion?: string;
  /** Each installed toolchain component's folder (a real path) and version. */
  readonly components: Partial<Record<ToolchainPart, { readonly path: string; readonly version: string }>>;
}

/**
 * What the HyperFrames CLI is told in the shell: offline, so no telemetry, update check or install on its own (each
 * would wait on a network the profile closes), and the FFmpeg it should run.
 */
export const HYPERFRAMES_ENV: Readonly<Record<string, string>> = {
  HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1',
  HYPERFRAMES_NO_AUTO_INSTALL: '1',
  HYPERFRAMES_NO_OPTIONAL_INSTALL: '1',
  DO_NOT_TRACK: '1',
};

/** The toolchain the shell gets from what is installed: folders to read and run, PATH, and their environment. */
export function assembleToolchain(parts: ToolchainParts): ShellToolchain {
  const roots: string[] = [];
  const bin: string[] = [];
  const env: Record<string, string> = {};
  const programs: { name: string; version: string }[] = [];
  for (const key of ['node', 'python', 'hyperframes'] as const) {
    const installed = parts.components[key];
    if (!installed) continue;
    const part = WORKSPACE_TOOLCHAIN[key];
    roots.push(installed.path);
    bin.push(`${installed.path}/${part.bin}`);
    programs.push({ name: part.program, version: installed.version });
    if (key === 'hyperframes') Object.assign(env, HYPERFRAMES_ENV);
  }
  if (parts.ffmpegDir) {
    roots.push(parts.ffmpegRoot ?? parts.ffmpegDir);
    bin.push(parts.ffmpegDir);
    if (parts.components.hyperframes) {
      env.HYPERFRAMES_FFMPEG_PATH = `${parts.ffmpegDir}/ffmpeg`;
      env.HYPERFRAMES_FFPROBE_PATH = `${parts.ffmpegDir}/ffprobe`;
    }
    programs.push({ name: 'ffmpeg', version: parts.ffmpegVersion ?? 'bundled' });
    programs.push({ name: 'ffprobe', version: parts.ffmpegVersion ?? 'bundled' });
  }
  if (parts.headlessShell) {
    const dir = dirname(parts.headlessShell);
    roots.push(dir);
    bin.push(dir);
    // HyperFrames reads its browser from here; the shell runs it with --no-sandbox inside the profile.
    env.HYPERFRAMES_BROWSER_PATH = parts.headlessShell;
    programs.push({ name: 'chrome-headless-shell', version: parts.headlessShellVersion ?? 'bundled' });
  }
  return { roots: [...new Set(roots)], bin, env, programs };
}
