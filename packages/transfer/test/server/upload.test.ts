// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { httpCall, startFixture, type Fixture } from '../support/harness';
import {
  beginUpload,
  pairPhone,
  sha256,
  tokenOf,
  uploadAll,
  videoBytes,
  type UploadTarget,
} from '../support/upload';

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const MIB = 1024 * 1024;

describe('tus uploads', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('uploads a generated video and the stored bytes match', async () => {
    fx = await startFixture();
    const data = videoBytes(4 * MIB);
    const credential = await paired(fx);
    const url = await uploadAll({ fx, credential, data, name: 'clip.mov', chunkSize: MIB });
    await fx.service.drained();
    const id = uploadId(url);
    const stored = await readFile(join(fx.staging, id));
    expect(sha256(stored)).toBe(sha256(data));
    const head = await httpCall({
      host: fx.address,
      port: fx.port,
      method: 'HEAD',
      path: `/files/${id}`,
      headers: { authorization: `Bearer ${credential}`, 'tus-resumable': '1.0.0' },
    });
    expect(head.status).toBe(200);
    expect(head.headers['upload-offset']).toBe(String(data.length));
  });

  it('resumes after the connection is dropped mid-upload', async () => {
    fx = await startFixture();
    const data = videoBytes(3 * MIB);
    const credential = await paired(fx);
    const first = beginUpload({ fx, credential, data, name: 'resume.mov', chunkSize: MIB, abortAfter: MIB });
    await first.paused;
    const url = first.upload.url;
    expect(url).toBeTruthy();
    const again = beginUpload({
      fx,
      credential,
      data,
      name: 'resume.mov',
      chunkSize: MIB,
      uploadUrl: url ?? undefined,
    });
    await again.done;
    await fx.service.drained();
    const stored = await readFile(join(fx.staging, uploadId(url ?? '')));
    expect(sha256(stored)).toBe(sha256(data));
  });

  it('resumes after the server process is killed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taalcut-kill-'));
    const stateDir = join(root, 'state');
    const staging = join(root, 'staging');
    const data = videoBytes(3 * MIB);
    let child: ChildProcess | undefined;
    try {
      const first = await startChild(stateDir, staging);
      child = first.child;
      const target = loopback(first.port);
      const credential = (await pairPhone(target, { token: first.token, pin: first.pin })).credential;
      const partial = beginUpload({
        fx: target,
        credential,
        data,
        name: 'killed.mov',
        chunkSize: MIB,
        onChunk(bytes) {
          if (bytes >= MIB) child?.kill('SIGKILL');
        },
      });
      await partial.done.catch(() => undefined);
      const url = partial.upload.url ?? '';
      await onceClosed(child);
      expect(first.stderr).not.toContain(first.token);
      expect(first.stderr).not.toContain(first.pin);
      const second = await startChild(stateDir, staging);
      child = second.child;
      const resumed = beginUpload({
        fx: loopback(second.port),
        credential,
        data,
        name: 'killed.mov',
        chunkSize: MIB,
        uploadUrl: retarget(url, second.port),
      });
      await resumed.done;
      const stored = await readFile(join(staging, uploadId(url)));
      expect(sha256(stored)).toBe(sha256(data));
      child.kill('SIGKILL');
      await onceClosed(child);
      child = undefined;
    } finally {
      child?.kill('SIGKILL');
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('uploads 256 MiB generated at test time', async () => {
    fx = await startFixture();
    const data = videoBytes(256 * MIB);
    const credential = await paired(fx);
    const url = await uploadAll({ fx, credential, data, name: 'large.mov', chunkSize: 8 * MIB });
    await fx.service.drained();
    const stored = await readFile(join(fx.staging, uploadId(url)));
    expect(createHash('sha256').update(stored).digest('hex')).toBe(sha256(data));
  }, 120_000);
});

async function paired(fx: Fixture): Promise<string> {
  const result = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin });
  expect(result.status).toBe(200);
  return result.credential;
}

function uploadId(url: string): string {
  return new URL(url).pathname.split('/').pop() ?? '';
}

function loopback(port: number): UploadTarget {
  return { address: '127.0.0.1', port, base: () => `http://127.0.0.1:${port}` };
}

function retarget(url: string, port: number): string {
  const parsed = new URL(url);
  parsed.port = String(port);
  return parsed.toString();
}

interface ReadyChild {
  readonly child: ChildProcess;
  readonly port: number;
  readonly token: string;
  readonly pin: string;
  readonly stderr: string;
}

function startChild(stateDir: string, staging: string): Promise<ReadyChild> {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, stateDir, staging], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    let pending = '';
    const timer = setTimeout(() => reject(new Error(`child produced no ready line\n${stderr}`)), 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited ${code} before ready\n${stderr}`));
    });
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      pending += chunk;
      const newline = pending.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      const ready = JSON.parse(pending.slice(0, newline)) as { port: number; token: string; pin: string };
      resolve({
        child,
        port: ready.port,
        token: ready.token,
        pin: ready.pin,
        get stderr() {
          return stderr;
        },
      });
    });
  });
}

function onceClosed(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('close', () => resolve()));
}
