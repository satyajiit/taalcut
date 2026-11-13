// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, newId, ok, type CreationSource } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createCreationLogoService,
  createCreationSourceService,
  creationSourceUrl,
  CreationSourceFailed,
  planCreationProject,
  safeCreationSvg,
  type CreationSourceHost,
} from '../src/creation';

function host(): CreationSourceHost {
  return {
    readAsset: vi.fn(async () => ok({ title: 'Uploaded', text: 'Picture', url: '', assets: [] })),
    snapshotDirectory: vi.fn(async () =>
      ok({
        id: 'snapshot-1',
        digest: 'abc',
        files: [
          { path: 'package.json', text: JSON.stringify({ scripts: { dev: 'vite' } }) },
          { path: 'pnpm-lock.yaml', text: 'lockfileVersion: 9' },
          { path: 'README.md', text: 'A verified app feature.' },
          { path: '.env', text: 'password=secret' },
        ],
      }),
    ),
    captureUrl: vi.fn(async (url) =>
      ok({ title: 'Actual product', text: 'Its actual screen', url, assets: [] }),
    ),
    runProject: vi.fn(async () =>
      ok({ title: 'Live project', text: 'Screen captured', url: 'http://127.0.0.1:4173', assets: [] }),
    ),
    request: vi.fn(async (url) =>
      ok({
        body: url.includes('api.svgl')
          ? JSON.stringify([{ title: 'Example', route: 'https://svgl.app/library/example.svg' }])
          : '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>',
        finalUrl: url,
      }),
    ),
  };
}
const source = (extra: Partial<CreationSource> = {}): CreationSource => ({
  id: newId<'CreationSource'>(),
  kind: 'url',
  label: 'Example',
  url: 'https://example.com',
  status: 'pending',
  assetIds: [],
  evidence: [],
  ...extra,
});

describe('creation source acquisition', () => {
  it('rejects credentialed, loopback, local and non-HTTP URLs before capture', async () => {
    for (const url of [
      'file:///etc/passwd',
      'http://127.0.0.1',
      'http://2130706433',
      'http://10.1.2.3',
      'http://x.local',
      'https://u:p@example.com',
    ])
      expect(creationSourceUrl(url)).toBeNull();
    expect(creationSourceUrl('https://example.com/a#fragment')).toBe('https://example.com/a');
    const h = host();
    expect(
      (
        await createCreationSourceService(h).inspect(
          source({ url: 'file:///etc/passwd' }),
          new AbortController().signal,
        )
      ).ok,
    ).toBe(false);
    expect(h.captureUrl).not.toHaveBeenCalled();
  });

  it('captures URLs and records factual provenance; source text is not executed', async () => {
    const h = host();
    const input = source();
    const result = await createCreationSourceService(h).inspect(input, new AbortController().signal);
    expect(result.ok && result.value.evidence[0]?.sourceId).toBe(input.id);
    expect(result.ok && result.value.content).toContain('actual screen');
    expect(h.runProject).not.toHaveBeenCalled();
  });

  it('plans managed project execution from a snapshot, omitting secrets', async () => {
    const h = host();
    const result = await createCreationSourceService(h).inspect(
      source({ kind: 'directory', accessId: 'picked-folder' }),
      new AbortController().signal,
    );
    expect(h.runProject).toHaveBeenCalledWith(
      {
        snapshotId: 'snapshot-1',
        packageManager: 'pnpm',
        script: 'dev',
        buildScript: null,
        install: true,
        timeoutMs: 180000,
      },
      expect.any(AbortSignal),
    );
    expect(result.ok && result.value.content).toContain('Screen captured');
    expect(result.ok && result.value.content).not.toContain('password=secret');
    expect(result.ok && result.value.content).not.toContain('lockfileVersion');
    expect(result.ok && result.value.content?.startsWith('File: README.md')).toBe(true);
  });

  it('keeps research when execution is unsupported and handles capture failures', async () => {
    const h = host();
    vi.mocked(h.runProject).mockResolvedValue(err(CreationSourceFailed()));
    const result = await createCreationSourceService(h).inspect(
      source({ kind: 'directory', accessId: 'picked-folder' }),
      new AbortController().signal,
    );
    expect(result.ok && result.value.content).toContain('Live capture unavailable');
    expect((await planCreationProject({ id: 'x', digest: 'x', files: [] })).ok).toBe(false);
    expect(
      (
        await planCreationProject({
          id: 'x',
          digest: 'x',
          files: [{ path: 'package.json', text: '{invalid' }],
        })
      ).ok,
    ).toBe(false);
    const cancelled = new AbortController();
    cancelled.abort();
    expect((await createCreationSourceService(h).inspect(source(), cancelled.signal)).ok).toBe(false);
  });
});

describe('SVGL acquisition', () => {
  it('retrieves inert SVGs with provenance and rejects active or remote markup', async () => {
    const result = await createCreationLogoService(host()).find('Example', new AbortController().signal);
    expect(result.ok && result.value[0]?.sourceUrl).toBe('https://svgl.app/library/example.svg');
    for (const svg of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="x"/>',
      '<svg><use href="https://bad"/></svg>',
      '<svg><style>path{fill:url(https://bad)}</style></svg>',
    ])
      expect(safeCreationSvg(svg)).toBe(false);
    expect(safeCreationSvg('<svg><path d="M0 0"/></svg>')).toBe(true);
  });
});
