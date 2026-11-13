// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.open`, `workspace.files` and `workspace.importMedia` (AGT2 sbx): inputs cloned read-only, the folder
 * listed and shown without leaving it, and a file in out/ kept through the generated sink with its undo.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  newId,
  ok,
  ValidationError,
  type AssetId,
  type GeneratedAssetSink,
  type GeneratedFile,
  type ProjectId,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceFilesTool, workspaceOpenTool } from '../src/shell/folder-tools';
import { ensureShellFolder } from '../src/shell/folder';
import { mediaTypeOf, workspaceImportCommand, workspaceImportTool } from '../src/shell/import-media';
import type { ShellToolDeps } from '../src/shell/tool-deps';
import { tempRoot } from './helpers/sandbox';
import { memoryWorkspace, toolContext } from './helpers/workspace-store';

let temp: { root: string; cleanup: () => void };
let projectId: ProjectId;
let shellRoot: string;
let folder: string;
beforeEach(async () => {
  temp = tempRoot('taalcut-shell-folder-');
  projectId = newId<'Project'>();
  shellRoot = join(temp.root, 'shell');
  const made = await ensureShellFolder(shellRoot, projectId, 1);
  if (!made.ok) throw new Error(made.error.code);
  folder = made.value.folder;
});
afterEach(() => temp.cleanup());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32)]);

function deps(assets: Record<string, string> = {}): ShellToolDeps {
  return {
    store: memoryWorkspace().store,
    root: shellRoot,
    runner: { run: async () => err(ValidationError({ field: 'command' })) },
    resolveInput: async (id: AssetId) =>
      assets[id] ? ok(assets[id]) : err(ValidationError({ field: 'inputs' })),
    toolchain: async () => ok({ programs: [{ name: 'ffmpeg', version: '8.0' }], missing: [] }),
  };
}

describe('workspace.open', () => {
  it('clones library media into inputs/ read-only, keeps them across opens, and lists the programs', async () => {
    const clip = join(temp.root, 'clip.mov');
    await writeFile(clip, 'frames');
    const assetId = newId<'Asset'>();
    const tool = workspaceOpenTool(deps({ [assetId]: clip }));
    const opened = await tool.run(
      { projectId, inputs: [assetId] },
      toolContext(async () => ok(null)),
    );
    expect(opened.ok && opened.value.inputs).toEqual([{ assetId, path: `inputs/${assetId}.mov`, bytes: 6 }]);
    expect(opened.ok && opened.value.programs).toEqual([{ name: 'ffmpeg', version: '8.0' }]);
    const cloned = join(folder, 'inputs', `${assetId}.mov`);
    expect(await readFile(cloned, 'utf8')).toBe('frames');
    expect((await stat(cloned)).mode & 0o777).toBe(0o444);
    const again = await tool.run(
      { projectId },
      toolContext(async () => ok(null)),
    );
    expect(again.ok && again.value.inputs).toHaveLength(1);
  });
});

describe('workspace.files', () => {
  const files = () => workspaceFilesTool(deps());
  const run = (input: object) =>
    files().run(
      { projectId, ...input } as never,
      toolContext(async () => ok(null)),
    );

  it('lists the folder without its manifest, tmp/ or home/', async () => {
    await writeFile(join(folder, 'out', 'a.txt'), 'a');
    await writeFile(join(folder, 'tmp', 'scratch'), 'x');
    await writeFile(join(folder, 'work', 'index.html'), 'x');
    const listing = await run({});
    expect(listing.ok && listing.value.kind === 'listing' && listing.value.files.map((f) => f.path)).toEqual([
      'out/a.txt',
      'work/index.html',
    ]);
    const out = await run({ dir: 'out' });
    expect(out.ok && out.value.kind === 'listing' && out.value.files).toEqual([
      { path: 'out/a.txt', bytes: 1 },
    ]);
  });

  it('shows an image as a picture and text as text', async () => {
    await writeFile(join(folder, 'out', 'shot.png'), PNG);
    await writeFile(join(folder, 'out', 'notes.txt'), 'hello');
    const image = await run({ view: 'out/shot.png' });
    expect(image.ok && image.value.kind).toBe('image');
    const refs = image.ok ? files().images!(image.value) : [];
    expect(refs).toHaveLength(1);
    expect(refs[0]!.mediaType).toBe('image/png');
    const text = await run({ view: 'out/notes.txt' });
    expect(text.ok && text.value.kind === 'text' && text.value.text).toBe('hello');
  });

  it("won't leave the folder by .., a link or a reserved name", async () => {
    await writeFile(join(temp.root, 'outside.txt'), 'secret');
    await symlink(join(temp.root, 'outside.txt'), join(folder, 'out', 'link.txt'));
    for (const view of ['../outside.txt', 'out/link.txt', 'shell.json', 'tmp/x', '/etc/hosts'])
      expect((await run({ view })).ok).toBe(false);
  });
});

describe('workspace.importMedia', () => {
  function sink(duplicate = false) {
    const puts: GeneratedFile[] = [];
    const port: GeneratedAssetSink = {
      async put(file) {
        puts.push(file);
        return ok({ assetId: newId<'Asset'>(), contentHash: 'h', duplicate });
      },
    };
    return { port, puts };
  }

  it('keeps a file from out/ as a generated workspace asset, undone by trashing it', async () => {
    await writeFile(join(folder, 'out', 'final.mp4'), MP4);
    const { port, puts } = sink();
    const command = workspaceImportCommand({ root: shellRoot, sink: port, clock: () => 42 });
    const done = await command.handle(
      { projectId, path: 'out/final.mp4', runId: null } as never,
      {} as never,
    );
    expect(done.ok).toBe(true);
    const outcome = done.ok ? (done.value as { result: { assetId: string }; inverse?: unknown }) : null;
    expect(outcome?.inverse).toEqual({
      name: 'library.trashAssets',
      payload: { assetIds: [outcome!.result.assetId] },
    });
    expect(puts[0]!.mediaType).toBe('video/mp4');
    expect(puts[0]!.provenance).toMatchObject({
      kind: 'generated',
      generation: 'workspace',
      access: 'local',
      promptSha256: createHash('sha256').update(MP4).digest('hex'),
      createdAt: 42,
    });
  });

  it('has nothing to undo for bytes the library had, and refuses what is outside out/ or not media', async () => {
    await writeFile(join(folder, 'out', 'still.png'), PNG);
    await writeFile(join(folder, 'out', 'notes.txt'), 'hello');
    await mkdir(join(folder, 'work'), { recursive: true });
    await writeFile(join(folder, 'work', 'clip.png'), PNG);
    const command = workspaceImportCommand({ root: shellRoot, sink: sink(true).port });
    const handle = (path: string) => command.handle({ projectId, path, runId: null } as never, {} as never);
    const dup = await handle('out/still.png');
    expect(dup.ok && (dup.value as { inverse?: unknown }).inverse).toBeUndefined();
    for (const path of ['out/notes.txt', 'work/clip.png', 'out/../work/clip.png', 'out/missing.mp4'])
      expect((await handle(path)).ok).toBe(false);
  });

  it('dispatches its command with the run, through a tool that keeps a fresh key per call', async () => {
    const tool = workspaceImportTool();
    const sent: unknown[] = [];
    const ctx = toolContext(async (payload) => {
      sent.push(payload);
      return ok({ assetId: 'A', duplicate: false, mediaType: 'video/mp4', bytes: 3 });
    });
    const done = await tool.run({ projectId, path: 'out/final.mp4' }, ctx);
    expect(done.ok && done.value.assetId).toBe('A');
    expect(sent[0]).toMatchObject({ projectId, path: 'out/final.mp4' });
    expect(tool.command).toBe('workspace.importMedia');
  });

  it('knows media by its first bytes', () => {
    const riff = (kind: string) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from(kind)]);
    expect(mediaTypeOf(MP4)).toBe('video/mp4');
    expect(mediaTypeOf(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  ')]))).toBe('video/quicktime');
    expect(mediaTypeOf(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]))).toBeNull();
    expect(mediaTypeOf(riff('WAVE'))).toBe('audio/wav');
    expect(mediaTypeOf(riff('WEBP'))).toBe('image/webp');
    expect(mediaTypeOf(Buffer.from('ID3\x04'))).toBe('audio/mpeg');
    expect(mediaTypeOf(Buffer.from('<html>'))).toBeNull();
  });
});

describe('the toolchain', () => {
  it('puts each installed part on PATH, lets the shell read its folder, and points HyperFrames at the shell', async () => {
    const { assembleToolchain } = await import('../src/shell/toolchain');
    const toolchain = assembleToolchain({
      ffmpegDir: '/app/ffmpeg',
      headlessShell: '/c/shell/chrome-headless-shell-mac-arm64/chrome-headless-shell',
      headlessShellVersion: '152.0.7977.30',
      components: {
        node: { path: '/c/node', version: '24.22.2' },
        hyperframes: { path: '/c/hf', version: '0.8.209' },
      },
    });
    expect(toolchain.bin).toEqual([
      '/c/node/bin',
      '/c/hf/bin',
      '/app/ffmpeg',
      '/c/shell/chrome-headless-shell-mac-arm64',
    ]);
    expect(toolchain.roots).toEqual([
      '/c/node',
      '/c/hf',
      '/app/ffmpeg',
      '/c/shell/chrome-headless-shell-mac-arm64',
    ]);
    expect(toolchain.env.HYPERFRAMES_BROWSER_PATH).toMatch(/chrome-headless-shell$/);
    expect(toolchain.env).toMatchObject({
      HYPERFRAMES_NO_TELEMETRY: '1',
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      HYPERFRAMES_FFMPEG_PATH: '/app/ffmpeg/ffmpeg',
    });
    expect(toolchain.programs.map((p) => p.name)).toEqual([
      'node',
      'hyperframes',
      'ffmpeg',
      'ffprobe',
      'chrome-headless-shell',
    ]);
  });
});
