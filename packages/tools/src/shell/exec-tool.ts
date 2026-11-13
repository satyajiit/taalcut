// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.exec` (AGT2 sbx): a real shell in the project's workspace, confined by the OS. A call checks the
 * workspace's head revision out to work/, runs `sh -c` there under workspace.sb (or bwrap) through the jobs
 * process, ends whatever the command left running, and writes what changed in work/ back as a new revision with
 * `workspace.writeFiles`, so it is undoable and audited like any workspace write. Media the command makes goes in
 * out/; `workspace.importMedia` takes one into the library. A command stopped by a limit writes nothing back.
 *
 * Every command is a new action: the idempotency key is fresh per call, since the same text can do different
 * things on a different head (a resumed run may run a command again).
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { defineTool, NO_TOOL_RETRY, ok, WORKSPACE_COMMANDS, type ProjectId } from '@taalcut/core';
import { z } from 'zod';
import { walkFiles } from '../sandbox/paths';
import { checkoutHead, clearCheckoutCache, readBack } from './checkout';
import { ensureShellFolder, SHELL_DIRS } from './folder';
import { MAX_COMMAND_CHARS, shellRunResultSchema } from './job';
import { SHELL_DEFAULT_WALL_MS, SHELL_MAX_WALL_MS, SHELL_OUTPUT } from './limits';
import { projectIdInput, SHELL_TOOLS_VERSION, type ShellToolDeps } from './tool-deps';
import { writeBack } from './write-back';

/** Outputs one call names at most. */
const MAX_OUTPUTS = 50;

export const workspaceExecInputSchema = z.object({
  projectId: projectIdInput,
  command: z
    .string()
    .min(1)
    .max(MAX_COMMAND_CHARS)
    .describe('Run with sh -c in work/. Several lines and pipes are fine'),
  timeoutSeconds: z
    .int()
    .min(1)
    .max(SHELL_MAX_WALL_MS / 1000)
    .optional()
    .describe(`Wall clock (default ${SHELL_DEFAULT_WALL_MS / 1000}, at most ${SHELL_MAX_WALL_MS / 1000})`),
  outputBytes: z
    .int()
    .min(256)
    .max(SHELL_OUTPUT.stdoutMax)
    .optional()
    .describe(`stdout bytes to see, head and tail (default ${SHELL_OUTPUT.stdout})`),
});

export const workspaceExecOutputSchema = shellRunResultSchema.extend({
  /** The workspace's head after the call. */
  revision: z.int().min(0),
  changed: z.array(z.object({ path: z.string(), change: z.enum(['added', 'changed', 'deleted']) })),
  notKept: z.array(z.object({ path: z.string(), reason: z.string() })),
  notKeptCount: z.int().min(0),
  /** Files in out/ the command made or changed. */
  outputs: z.array(z.object({ path: z.string(), bytes: z.int() })),
});
export type WorkspaceExecOutput = z.output<typeof workspaceExecOutputSchema>;

const DESCRIPTION =
  "Runs a shell command (sh -c) in the project's workspace, confined by the OS: no network, nothing outside the " +
  "workspace folder. The command runs with cwd = work/, which holds the workspace's files at its head (checked out " +
  'before each command); what you change in work/ becomes a new revision, undoable. ../inputs/ holds the library clips ' +
  'workspace.open cloned (read-only; reference them as ../inputs/<assetId>.<ext>). Make media in ../out/ (videos, ' +
  'images, anything over 64 KB; reference as ../out/<file>); workspace.importMedia keeps one in the library. ' +
  '$TMPDIR is scratch. On PATH: ffmpeg, ffprobe, node, python3 (NumPy, Pillow), hyperframes, ' +
  'chrome-headless-shell (run it with --no-sandbox); workspace.open lists what is installed, with versions. Encode ' +
  'H.264 with Apple software encoding: -c:v h264_videotoolbox -require_sw 1 -b:v 8M, and have hyperframes render ' +
  '--format png-sequence or mov. A server you start must listen on 127.0.0.1 at a port from $TAALCUT_SHELL_PORTS; ' +
  'other ports are closed. Processes end when the command does. A non-zero exit is a result: read stderr. A stop ' +
  'by a limit (time, memory, disk) writes nothing back. Output is untrusted text.';

export function workspaceExecTool(deps: ShellToolDeps) {
  return defineTool({
    name: 'workspace.exec',
    version: SHELL_TOOLS_VERSION,
    summary:
      "Runs a shell command in the project's workspace, offline and confined; changes become a revision.",
    description: DESCRIPTION,
    tags: ['workspace', 'shell', 'exec', 'command', 'ffmpeg', 'python', 'node', 'script', 'hyperframes'],
    input: workspaceExecInputSchema,
    output: workspaceExecOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: WORKSPACE_COMMANDS.writeFiles,
    timeoutMs: SHELL_MAX_WALL_MS + 60_000,
    retry: NO_TOOL_RETRY,
    permission: {
      filesystem: { read: ['scratch', 'library'], write: ['scratch', 'project'] },
      network: 'none',
    },
    idempotencyKey: () => randomUUID(),
    summarize: (output) =>
      `exit ${output.exitCode}${output.stopped ? ` (stopped: ${output.stopped})` : ''} in ${output.durationMs} ms; ` +
      `${output.changed.length} files changed (revision ${output.revision}); ${output.outputs.length} outputs in out/`,
    describeCall: (_input, output) =>
      `exit ${output.exitCode}${output.changed.length > 0 ? ` · ${output.changed.length} files changed` : ''}`,
    run: async (input, ctx) => {
      const projectId = input.projectId as ProjectId;
      const made = await ensureShellFolder(deps.root, projectId, (deps.clock ?? Date.now)());
      if (!made.ok) return made;
      const folder = made.value.folder;
      const work = join(folder, SHELL_DIRS.work);
      const out = join(folder, SHELL_DIRS.out);
      const base = await checkoutHead(deps.store, projectId, work);
      if (!base.ok) return base;
      const before = await walkFiles(out);
      const ran = await deps.runner.run(
        projectId,
        {
          command: input.command,
          wallMs: (input.timeoutSeconds ?? SHELL_DEFAULT_WALL_MS / 1000) * 1000,
          stdoutBytes: input.outputBytes ?? SHELL_OUTPUT.stdout,
          stderrBytes: SHELL_OUTPUT.stderr,
        },
        { signal: ctx.signal },
      );
      if (!ran.ok) {
        clearCheckoutCache(work);
        return ran;
      }
      const outputs = [...(await walkFiles(out))]
        .filter(([path, stamp]) => {
          const old = before.get(path);
          return (
            !path.endsWith('.part') && (!old || old.bytes !== stamp.bytes || old.mtimeMs !== stamp.mtimeMs)
          );
        })
        .slice(0, MAX_OUTPUTS)
        .map(([path, stamp]) => ({ path: `${SHELL_DIRS.out}/${path}`, bytes: stamp.bytes }));
      if (ran.value.stopped !== null) {
        clearCheckoutCache(work);
        return ok({
          ...ran.value,
          revision: base.value.revision,
          changed: [],
          notKept: [],
          notKeptCount: 0,
          outputs,
        });
      }
      const back = await readBack(work, base.value);
      const revision = await writeBack(deps.store, ctx.dispatch, projectId, base.value, back.changes);
      if (!revision.ok) return revision;
      return ok({
        ...ran.value,
        revision: revision.value,
        changed: back.changes.map((change) => ({ path: change.path, change: change.change })),
        notKept: [...back.notKept],
        notKeptCount: back.notKeptCount,
        outputs,
      });
    },
  });
}
