// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import { SidecarRejected, type JsonLineSidecar, type JsonValue } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContentCredentials, signatureState } from '../../src/credentials/content-credentials';
import {
  createC2paSidecarClient,
  type C2paReadSummary,
  type C2paSidecar,
} from '../../src/credentials/sidecar';

const summary = (overrides: Partial<C2paReadSummary> = {}): C2paReadSummary => ({
  state: 'valid',
  generator: 'Provider 2.0',
  issuer: 'Provider Inc.',
  digitalSourceTypes: ['http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'],
  actions: ['c2pa.created'],
  actionsV2: true,
  ingredients: 0,
  ingredientDetails: [],
  failures: ['signingCredential.untrusted'],
  ...overrides,
});

function fakeSidecar(answers: {
  read?: AsyncResult<C2paReadSummary>;
  sign?: AsyncResult<C2paReadSummary>;
}): C2paSidecar & { signs: number } {
  const fake = {
    signs: 0,
    read: () => answers.read ?? Promise.resolve(ok(summary())),
    sign: () => {
      fake.signs += 1;
      return answers.sign ?? Promise.resolve(ok(summary()));
    },
    close: async () => undefined,
  };
  return fake;
}

const request = { input: '/work/final.mp4', output: '/work/signed.mp4', manifest: {}, ingredients: [] };

describe('createContentCredentials', () => {
  it('reads unknown without the component, and never fails a read', async () => {
    const missing = createContentCredentials({ sidecar: async () => null });
    expect(await missing.read('/x.mp4')).toEqual(ok({ presence: 'unknown', summary: null }));
    const broken = createContentCredentials({
      sidecar: async () =>
        fakeSidecar({ read: Promise.resolve(err(SidecarRejected({ helperCode: 'c2pa.unreadable' }))) }),
    });
    expect(await broken.read('/x.mp4')).toEqual(ok({ presence: 'unknown', summary: null }));
    const throwing = createContentCredentials({ sidecar: () => Promise.reject(new Error('spawn failed')) });
    expect(await throwing.read('/x.mp4')).toEqual(ok({ presence: 'unknown', summary: null }));
  });

  it('reports absent and present files with the bounded summary', async () => {
    const absent = createContentCredentials({
      sidecar: async () => fakeSidecar({ read: Promise.resolve(ok(summary({ state: 'absent' }))) }),
    });
    expect(await absent.read('/x.mp4')).toEqual(ok({ presence: 'absent', summary: null }));
    const present = createContentCredentials({
      sidecar: async () => fakeSidecar({ read: Promise.resolve(ok(summary({ ingredients: 2 }))) }),
    });
    expect(await present.read('/x.mp4')).toEqual(
      ok({
        presence: 'present',
        summary: {
          state: 'valid',
          generator: 'Provider 2.0',
          issuer: 'Provider Inc.',
          digitalSourceTypes: ['http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'],
          ingredients: 2,
        },
      }),
    );
  });

  it('refuses to sign without the component instead of delivering an unsigned file', async () => {
    const result = await createContentCredentials({ sidecar: async () => null }).sign(request);
    expect(result.ok ? null : result.error.code).toBe('render.credentials_unavailable');
    const failed = await createContentCredentials({
      sidecar: async () =>
        fakeSidecar({ sign: Promise.resolve(err(SidecarRejected({ helperCode: 'c2pa.sign_failed' }))) }),
    }).sign(request);
    expect(failed.ok ? null : failed.error).toMatchObject({
      code: 'render.credentials_unavailable',
      retryable: true,
    });
  });

  it('signs, judges the signature and reports the CPU route once', async () => {
    const events: ComputeFallbackEvent[] = [];
    const sidecar = fakeSidecar({});
    const credentials = createContentCredentials({
      sidecar: async () => sidecar,
      onFallback: (event) => events.push(event),
    });
    expect(await credentials.sign(request)).toMatchObject({
      ok: true,
      value: { state: 'valid', failures: [] },
    });
    await credentials.sign(request);
    expect(sidecar.signs).toBe(2);
    expect(events).toEqual([expect.objectContaining({ operation: 'render.sign', reason: 'no_accelerator' })]);
  });

  it('calls a store valid only with nothing beyond the untrusted issuer', () => {
    expect(signatureState(summary())).toBe('valid');
    expect(signatureState(summary({ state: 'trusted', failures: [] }))).toBe('valid');
    expect(signatureState(summary({ failures: ['assertion.bmffHash.mismatch'] }))).toBe('invalid');
    expect(signatureState(summary({ state: 'invalid' }))).toBe('invalid');
    expect(signatureState(summary({ state: 'absent', failures: [] }))).toBe('invalid');
  });
});

describe('readBytes', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-render-staged-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('is there only with a staging folder', () => {
    expect(createContentCredentials({ sidecar: async () => null }).readBytes).toBeUndefined();
    expect(createContentCredentials({ sidecar: async () => null, stagingDir: dir }).readBytes).toBeDefined();
  });

  it("reads the bytes as a private file with the media type's extension, then removes it", async () => {
    const staging = join(dir, 'reads');
    const seen: { path: string; bytes: Uint8Array }[] = [];
    const sidecar: C2paSidecar = {
      ...fakeSidecar({}),
      read: async (path) => {
        seen.push({ path, bytes: new Uint8Array(await readFile(path)) });
        return ok(summary());
      },
    };
    const credentials = createContentCredentials({ sidecar: async () => sidecar, stagingDir: staging });
    const read = await credentials.readBytes?.(bytes, 'image/jpeg');
    expect(read).toMatchObject({ ok: true, value: { presence: 'present', summary: { state: 'valid' } } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path.startsWith(staging)).toBe(true);
    expect(seen[0]!.path.endsWith('.jpg')).toBe(true);
    expect(seen[0]!.bytes).toEqual(bytes);
    await credentials.readBytes?.(bytes, 'audio/mpeg');
    expect(seen[1]!.path.endsWith('.mp3')).toBe(true);
    expect(await readdir(staging)).toEqual([]);
  });

  it('answers unknown, never an error, when the bytes cannot be staged or read', async () => {
    const blocker = join(dir, 'a-file');
    await writeFile(blocker, 'not a folder');
    const unstaged = createContentCredentials({
      sidecar: async () => fakeSidecar({}),
      stagingDir: join(blocker, 'staged'),
    });
    expect(await unstaged.readBytes?.(bytes, 'image/png')).toEqual(
      ok({ presence: 'unknown', summary: null }),
    );
    const staging = join(dir, 'unread');
    const missing = createContentCredentials({ sidecar: async () => null, stagingDir: staging });
    expect(await missing.readBytes?.(bytes, 'image/png')).toEqual(ok({ presence: 'unknown', summary: null }));
    const unreadable = createContentCredentials({
      sidecar: async () =>
        fakeSidecar({ read: Promise.resolve(err(SidecarRejected({ helperCode: 'c2pa.unreadable' }))) }),
      stagingDir: staging,
    });
    expect(await unreadable.readBytes?.(bytes, 'image/webp')).toEqual(
      ok({ presence: 'unknown', summary: null }),
    );
    expect(await readdir(staging)).toEqual([]);
  });
});

describe('createC2paSidecarClient', () => {
  const client = (answer: AsyncResult<JsonValue>, seen: { method?: string; params?: JsonValue }[] = []) => {
    const sidecar: JsonLineSidecar = {
      ready: async () => ok(null),
      request: (method, params) => {
        seen.push({ method, params });
        return answer;
      },
      close: async () => undefined,
    };
    return createC2paSidecarClient(sidecar);
  };

  it('validates what the sidecar answers', async () => {
    const good = summary({ ingredients: 1 });
    expect(await client(Promise.resolve(ok({ ...good })), []).read('/a.mp4')).toEqual(ok(good));
    const bad = await client(Promise.resolve(ok({ state: 'mystery' }))).read('/a.mp4');
    expect(bad.ok ? null : bad.error.code).toBe('core.validation');
  });

  it('sends the sign request with labels only when given', async () => {
    const seen: { method?: string; params?: JsonValue }[] = [];
    await client(Promise.resolve(ok({ ...summary() })), seen).sign({
      ...request,
      ingredients: [{ path: '/lib/a.mp4', title: 'clip 1', relationship: 'componentOf' }],
    });
    expect(seen[0]).toEqual({
      method: 'c2pa.sign',
      params: {
        input: '/work/final.mp4',
        output: '/work/signed.mp4',
        manifest: {},
        ingredients: [{ path: '/lib/a.mp4', title: 'clip 1', relationship: 'componentOf' }],
      },
    });
  });
});
