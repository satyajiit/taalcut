// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One real round trip on macOS (AGT2 sbx): workspace.exec through the exec-mode runner, confined by workspace.sb,
 * with the repo's FFmpeg on PATH. The command edits the workspace and renders a clip into out/; the edit becomes
 * a revision and workspace.importMedia keeps the clip as a video.
 */
import { dirname, join } from 'node:path';
import { newId, ok, type GeneratedFile, type ProjectId } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceExecTool } from '../../src/shell/exec-tool';
import { workspaceImportCommand } from '../../src/shell/import-media';
import { createShellRunner } from '../../src/shell/shell-runner';
import { findFfmpeg, skipMessage, tempRoot } from '../helpers/sandbox';
import { nodeToolchain, shellSkipReason } from '../helpers/shell';
import { memoryWorkspace, toolContext } from '../helpers/workspace-store';

const ffmpeg = findFfmpeg();
const skip = shellSkipReason() || ('skip' in ffmpeg ? ffmpeg.skip : '');
skipMessage('workspace shell round trip', skip);

let temp: { root: string; cleanup: () => void };
let projectId: ProjectId;
beforeEach(() => {
  temp = tempRoot('taalcut-shell-exec-');
  projectId = newId<'Project'>();
});
afterEach(() => temp.cleanup());

describe.skipIf(skip !== '')('workspace.exec, confined', { timeout: 120_000 }, () => {
  it('edits the workspace, renders into out/, and the render is imported as a video', async () => {
    const root = join(temp.root, 'shell');
    const ws = memoryWorkspace();
    await ws.write(projectId, { 'index.html': '<p>draft</p>' });
    const node = nodeToolchain();
    const dir = 'dir' in ffmpeg ? ffmpeg.dir : '';
    const runner = createShellRunner({
      root,
      toolchain: async () => ({ ...node, roots: [...node.roots, dirname(dir)], bin: [dir, ...node.bin] }),
    });
    const tool = workspaceExecTool({ store: ws.store, root, runner, resolveInput: async () => ok('/none') });
    const result = await tool.run(
      {
        projectId,
        command: [
          "sed -i '' 's/draft/final/' index.html",
          'ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=160x90:duration=0.5 -c:v h264_videotoolbox -require_sw 1 -b:v 512k ../out/clip.mp4',
          'echo rendered',
        ].join(' && '),
      },
      toolContext(ws.dispatch),
    );
    expect(result.ok ? result.value.stderr : result.error).toBe('');
    expect(result.ok && result.value.stdout.trim()).toBe('rendered');
    expect(result.ok && result.value.changed).toEqual([{ path: 'index.html', change: 'changed' }]);
    expect(result.ok && result.value.outputs.map((o) => o.path)).toEqual(['out/clip.mp4']);
    expect(await ws.text(projectId, 'index.html')).toBe('<p>final</p>');

    const kept: GeneratedFile[] = [];
    const command = workspaceImportCommand({
      root,
      sink: {
        async put(file) {
          kept.push(file);
          return ok({ assetId: newId<'Asset'>(), contentHash: 'h', duplicate: false });
        },
      },
    });
    const imported = await command.handle(
      { projectId, path: 'out/clip.mp4', runId: null } as never,
      {} as never,
    );
    expect(imported.ok).toBe(true);
    expect(kept[0]?.mediaType).toBe('video/mp4');
  });
});
