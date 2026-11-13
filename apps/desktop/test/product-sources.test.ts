// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer, newId, ok, productSchema, productSourceSchema, unwrap } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grantCreationDirectory } from '../src/shared/creation-grants';
import { creationSourceHost } from '../src/utility/creation/sources';
import { fetchCreationResource } from '../src/utility/creation/network';
import { productDirectoryEvidence } from '../src/utility/products/directory-evidence';
import { productSources } from '../src/utility/products/sources';

vi.mock('../src/utility/creation/sources', () => ({ creationSourceHost: vi.fn() }));
vi.mock('../src/utility/creation/network', () => ({ fetchCreationResource: vi.fn() }));

const cleanups: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const signal = () => new AbortController().signal;
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'taalcut-product-sources-'));
  cleanups.push(base);
  const userData = join(base, 'data');
  const repository = join(base, 'project');
  await mkdir(repository);
  const grant = await grantCreationDirectory(userData, repository);
  const source = productSourceSchema.parse({
    id: newId<'CreationSource'>(),
    kind: 'directory',
    label: 'Demo',
    accessId: grant.accessId,
  });
  const manifest = join(
    userData,
    'products',
    'indexes',
    `${createHash('sha256').update(grant.accessId).digest('hex')}.json`,
  );
  return { base, repository, userData, source, manifest };
}

describe('read-only product directory evidence', () => {
  it('reads only grant-scoped regular text, excludes secret/cache paths and redacts before caching', async () => {
    const f = await fixture();
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const original = `# Product\nFast timeline. apiKey: "${secret}"`;
    await writeFile(join(f.repository, 'README.md'), original);
    await writeFile(join(f.repository, 'binary.ts'), Buffer.from([1, 0, 2]));
    await writeFile(join(f.repository, 'huge.md'), 'x'.repeat(512 * 1024 + 1));
    for (const folder of ['.git', 'node_modules', '.cache', '.turbo', '.aws']) {
      await mkdir(join(f.repository, folder));
      await writeFile(join(f.repository, folder, 'secret.json'), 'private');
    }
    for (const name of ['.env', '.env.production', 'credentials.json', 'secrets.yaml', 'private.key'])
      await writeFile(join(f.repository, name), 'private');
    await mkdir(join(f.base, 'outside'));
    await writeFile(join(f.base, 'outside', 'private.md'), 'outside grant');
    await symlink(join(f.base, 'outside'), join(f.repository, 'linked-dir'));
    await symlink(join(f.base, 'outside', 'private.md'), join(f.repository, 'linked.md'));
    const found = unwrap(await productDirectoryEvidence(f.userData, f.source, signal(), 123));
    expect(found.map((item) => item.locator)).toEqual(['README.md']);
    expect(found[0]).toMatchObject({ capturedAt: 123, sourceId: f.source.id });
    expect(found[0]!.text).toContain('[redacted:');
    expect(found[0]!.text).not.toContain(secret);
    expect(await readFile(f.manifest, 'utf8')).not.toContain(secret);
    expect((await stat(f.manifest)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(f.repository, 'README.md'), 'utf8')).toBe(original);
  });

  it('reuses unchanged content and replaces edited/deleted entries without stale evidence', async () => {
    const f = await fixture();
    await writeFile(join(f.repository, 'README.md'), 'Before');
    await writeFile(join(f.repository, 'old.ts'), 'Old feature');
    const first = unwrap(await productDirectoryEvidence(f.userData, f.source, signal(), 100));
    const cached = unwrap(await productDirectoryEvidence(f.userData, f.source, signal(), 200));
    expect(cached.map((item) => item.digest)).toEqual(first.map((item) => item.digest));
    expect(cached.every((item) => item.capturedAt === 200)).toBe(true);
    await writeFile(join(f.repository, 'README.md'), 'After editing');
    await rm(join(f.repository, 'old.ts'));
    const changed = unwrap(await productDirectoryEvidence(f.userData, f.source, signal(), 300));
    expect(changed).toHaveLength(1);
    expect(changed[0]!.text).toBe('After editing');
    expect(changed[0]!.digest).not.toBe(first[0]!.digest);
    expect(await readFile(f.manifest, 'utf8')).not.toContain('old.ts');
  });

  it('refuses missing, forged, replaced and cancelled grants', async () => {
    const f = await fixture();
    expect(
      (await productDirectoryEvidence(f.userData, { ...f.source, accessId: undefined }, signal())).ok,
    ).toBe(false);
    expect(
      (await productDirectoryEvidence(f.userData, { ...f.source, accessId: '../escape' }, signal())).ok,
    ).toBe(false);
    const abort = new AbortController();
    abort.abort();
    const cancelled = await productDirectoryEvidence(f.userData, f.source, abort.signal);
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await rename(f.repository, join(f.base, 'previous'));
    await mkdir(f.repository);
    expect((await productDirectoryEvidence(f.userData, f.source, signal())).ok).toBe(false);
  });

  it('bounds document count and labels incomplete coverage instead of claiming missing features', async () => {
    const f = await fixture();
    await Promise.all(
      Array.from({ length: 2001 }, (_, index) =>
        writeFile(join(f.repository, `${index}.md`), `Feature ${index}`),
      ),
    );
    const found = unwrap(await productDirectoryEvidence(f.userData, f.source, signal()));
    expect(found).toHaveLength(2001);
    expect(found.at(-1)).toMatchObject({ locator: 'taalcut:index-coverage' });
    expect(found.at(-1)!.text).toContain('missing evidence must not be treated as an absent feature');
  });
});

describe('product source routing', () => {
  async function world() {
    const f = await fixture();
    const product = productSchema.parse({
      name: 'Demo',
      id: newId<'Product'>(),
      revision: 1,
      createdAt: 100,
      updatedAt: 100,
      archivedAt: null,
    });
    const service = productSources(createContainer(), {
      process: 'agent',
      userData: f.userData,
      dbPath: ':memory:',
      resourcesPath: f.base,
      packaged: false,
      componentManifest: '',
    });
    return { ...f, product, service };
  }

  it('never starts a project during directory research, even when live capture is opted in', async () => {
    const f = await world();
    await writeFile(join(f.repository, 'package.json'), '{"scripts":{"dev":"touch executed"}}');
    const found = unwrap(await f.service.inspect(f.product, { ...f.source, liveCapture: true }, signal()));
    expect(found[0]!.locator).toBe('package.json');
    expect(creationSourceHost).not.toHaveBeenCalled();
    expect(fetchCreationResource).not.toHaveBeenCalled();
  });

  it('fetches bounded public page text without running scripts and redacts secrets', async () => {
    const f = await world();
    const source = productSourceSchema.parse({
      id: newId<'CreationSource'>(),
      kind: 'url',
      label: 'Site',
      url: 'https://example.com',
    });
    vi.mocked(fetchCreationResource).mockResolvedValue(
      ok({
        url: 'https://example.com/about',
        contentType: 'text/html',
        bytes: new TextEncoder().encode(
          '<style>hidden style</style><script>run()</script><h1>Feature &amp; flow</h1><p>apiKey="secret-for-testing-only"</p>',
        ),
      }),
    );
    const found = unwrap(await f.service.inspect(f.product, source, signal()));
    expect(found[0]!.text).toContain('Feature & flow');
    expect(found[0]!.text).not.toMatch(/run\(\)|hidden style|secret-for-testing-only/);
    expect(found[0]!.locator).toBe('https://example.com/about#part-1');
    expect(fetchCreationResource).toHaveBeenCalledWith(source.url, {
      signal: expect.any(AbortSignal),
      maxBytes: 2 * 1024 * 1024,
    });
    expect(creationSourceHost).not.toHaveBeenCalled();
  });

  it('preserves plain-text code comparisons and refuses binary URL evidence', async () => {
    const f = await world();
    const source = productSourceSchema.parse({
      id: newId<'CreationSource'>(),
      kind: 'url',
      label: 'Docs',
      url: 'https://example.com/docs',
    });
    vi.mocked(fetchCreationResource).mockResolvedValue(
      ok({
        url: source.url!,
        contentType: 'text/plain',
        bytes: new TextEncoder().encode('if (x < 3 && y > 0)'),
      }),
    );
    expect(unwrap(await f.service.inspect(f.product, source, signal()))[0]!.text).toBe('if (x < 3 && y > 0)');
    vi.mocked(fetchCreationResource).mockResolvedValue(
      ok({ url: source.url!, contentType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }),
    );
    expect((await f.service.inspect(f.product, source, signal())).ok).toBe(false);
  });
});
