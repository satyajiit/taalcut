// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-E3 acceptance: "An interrupted 500 MB download resumes."
 *
 * A child process starts installing a 500 MiB component from the local server
 * and is SIGKILLed once 200 MiB are on disk. A fresh manager in this process
 * then installs the same component: it must ask for exactly the missing bytes
 * (Range from the part's size, If-Range with the ETag), and the installed file
 * must hash to the manifest's sha256.
 *
 * The content is generated on the fly (2 MiB of memory, no fixture). Peak disk
 * use is one 500 MiB file, deleted afterwards. Takes a few seconds on an M1;
 * set TAALCUT_SKIP_LARGE_TESTS=1 to skip it in quick runs.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createComponentManager, sha256File, type ComponentPhase } from '@taalcut/jobs';
import { fileSize } from '../src/components/fs-util';
import { componentLayout, partPathFor } from '../src/components/layout';
import { DeterministicContent, TEST_NOTICE } from './helpers/content';
import { componentJson, listFiles, manifestOf, PLATFORM, plentyOfSpace, tempDir } from './helpers/fixtures';
import { TestServer } from './helpers/server';

const MiB = 1024 * 1024;
const SIZE = 500 * MiB;
const KILL_AT = 200 * MiB;
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const childScript = join(packageDir, 'test', 'helpers', 'install-child.ts');

let server: TestServer;
let work: string;
let child: ChildProcess | undefined;

beforeAll(async () => {
  server = await TestServer.start();
  work = await tempDir('taalcut-large-');
});
afterAll(async () => {
  child?.kill('SIGKILL');
  await server.close();
  await rm(work, { recursive: true, force: true });
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(process.env.TAALCUT_SKIP_LARGE_TESTS === '1')('500 MiB download (P1-E3 acceptance)', () => {
  it('resumes from the right offset after the process is killed mid-download', async () => {
    const content = new DeterministicContent(SIZE, 'large-model');
    const sha256 = content.sha256();
    const spec = {
      id: 'large-model',
      urls: [server.url('/large.onnx')],
      size: SIZE,
      sha256,
      fileName: 'large.onnx',
    };
    const manifest = manifestOf(spec);
    const manifestPath = join(work, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, components: [componentJson(spec)] }));
    const root = join(work, 'components');
    const part = partPathFor(componentLayout(root), 'large-model', '1.0.0', sha256);

    server.serve('/large.onnx', { content, etag: '"large-1"' });
    server.next('/large.onnx', { holdAfterBytes: KILL_AT });
    const held = server.waitForHold();
    let stderr = '';
    child = spawn(process.execPath, ['--import', 'tsx', childScript, root, manifestPath, 'large-model'], {
      cwd: packageDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = once(child, 'exit');
    await Promise.race([held, exited.then(() => Promise.reject(new Error(`child exited early: ${stderr}`)))]);
    // The server has sent 200 MiB; wait until the child has written all of it, then kill it.
    await waitFor(async () => (await fileSize(part)) === KILL_AT, 30_000, 'the part file to reach 200 MiB');
    child.kill('SIGKILL');
    await exited;
    expect(child.signalCode).toBe('SIGKILL');
    const offset = (await stat(part)).size;
    expect(offset).toBe(KILL_AT);

    // "Restart the app": a new manager over the same folder.
    const phases = new Set<ComponentPhase>();
    const manager = createComponentManager({
      root,
      manifest,
      fetch: globalThis.fetch,
      statfs: plentyOfSpace,
      platform: PLATFORM,
    });
    const result = await manager.install('large-model', { onProgress: (p) => phases.add(p.phase) });
    expect(result.ok).toBe(true);
    const installed = result.ok ? result.value : undefined;

    const [first, resume, ...rest] = server.requestsFor('/large.onnx');
    expect(first).toMatchObject({ range: undefined, status: 200, bytesSent: KILL_AT });
    expect(resume).toMatchObject({
      range: `bytes=${offset}-`,
      ifRange: '"large-1"',
      status: 206,
      start: offset,
    });
    expect(resume!.bytesSent).toBe(SIZE - offset);
    expect(rest).toEqual([]);
    expect([...phases]).toEqual(['checking', 'downloading', 'verifying', 'installing']);

    // An independent re-hash of the installed file, not the downloader's own digest.
    expect(installed!.bytes).toBe(SIZE + TEST_NOTICE.size);
    expect(await sha256File(installed!.file!)).toBe(sha256);
    // One copy on disk: the part was renamed into place, not copied; its licence notice beside it.
    expect(await listFiles(root)).toEqual([
      `installed/large-model/1.0.0-${sha256.slice(0, 12)}/TAALCUT-NOTICE.txt`,
      `installed/large-model/1.0.0-${sha256.slice(0, 12)}/large.onnx`,
      'registry.json',
    ]);
    await rm(root, { recursive: true, force: true });
  }, 120_000);
});
