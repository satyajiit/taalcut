// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The manifest schema, the example manifest in tools/components, and the selection helpers. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import {
  componentsForTier,
  dependentsOf,
  installIdempotencyKey,
  installOrder,
  isAllowedDownloadUrl,
  manifestJsonSchema,
  MAX_NOTICE_BYTES,
  parseManifest,
  requiresAttribution,
  selectArtifact,
} from '@taalcut/jobs';
import { componentJson, MIT_LICENCE } from './helpers/fixtures';

const toolsDir = new URL('../../../tools/components/', import.meta.url);
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, toolsDir)), 'utf8'));
const example = unwrap(parseManifest(readJson('manifest.example.json')));

const sha = 'a'.repeat(64);
const component = (overrides: Record<string, unknown> = {}) => ({
  ...componentJson({ id: 'x', urls: ['https://example.org/x.bin'], size: 10, sha256: sha }),
  ...overrides,
});
/** The one artifact of `component()`, to vary in the rejection cases. */
const base = (component().artifacts as Record<string, unknown>[])[0]!;
const parse = (...components: unknown[]) => parseManifest({ schemaVersion: 1, components });
const failure = (result: ReturnType<typeof parseManifest>) => (!result.ok ? result.error.detail : undefined);

describe('manifest schema', () => {
  it('accepts the example manifest, whose entries are all clearly placeholders', () => {
    expect(example.components.map((c) => c.id)).toEqual([
      'onnxruntime',
      'embeddinggemma-2',
      'beat-this',
      'sherpa-onnx',
      'parakeet-tdt-0-6b-v3',
      'parakeet-tdt-0-6b-v3-coreml',
      'whisper-cpp',
      'whisper-tiny',
      'whisper-small-q8-0',
      'whisper-medium-q5-0',
      'deno',
      'reference-fetcher',
    ]);
    for (const artifact of example.components.flatMap((c) => c.artifacts)) {
      expect(artifact.sha256).toBe('0'.repeat(64));
      for (const url of artifact.urls) expect(new URL(url).hostname).toMatch(/\.invalid$/);
    }
    for (const { notice } of example.components.map((c) => c.licence)) {
      expect(notice.sha256).toBe('0'.repeat(64));
      expect(new URL(notice.url).hostname).toMatch(/\.invalid$/);
    }
    const parakeet = example.components.find((c) => c.id === 'parakeet-tdt-0-6b-v3')!;
    expect(parakeet.licence).toMatchObject({
      spdx: 'CC-BY-4.0',
      attribution: expect.stringContaining('NVIDIA'),
    });
  });

  it('matches the committed JSON Schema (run schema:export after changing the zod schema)', () => {
    expect(readJson('manifest.schema.json')).toEqual(manifestJsonSchema());
  });

  it('fills in defaults', () => {
    const parsed = unwrap(
      parseManifest({
        schemaVersion: 1,
        components: [
          {
            id: 'm',
            name: 'M',
            version: '1',
            kind: 'model',
            licence: MIT_LICENCE,
            artifacts: [
              {
                platform: 'any',
                urls: ['https://e.org/m'],
                sha256: sha,
                size: 1,
                install: { type: 'file', fileName: 'm' },
              },
              {
                platform: 'darwin-arm64',
                urls: ['https://e.org/m.tar'],
                sha256: sha,
                size: 1,
                install: { type: 'archive', format: 'tar', extractedSize: 5 },
              },
            ],
          },
        ],
      }),
    );
    const [entry] = parsed.components;
    expect(entry).toMatchObject({ tiers: [], dependencies: [] });
    expect(entry!.artifacts[0]!.install).toEqual({ type: 'file', fileName: 'm', executable: false });
    expect(entry!.artifacts[1]!.install).toMatchObject({ stripComponents: 0 });
  });

  it.each([
    ['duplicate ids', [component(), component()], /Duplicate id 'x'/],
    ['an unknown dependency', [component({ dependencies: ['nope'] })], /Unknown dependency 'nope'/],
    ['a self dependency', [component({ dependencies: ['x'] })], /depend on itself/],
    [
      'a dependency cycle',
      [component({ id: 'a', dependencies: ['b'] }), component({ id: 'b', dependencies: ['a'] })],
      /cycle: a → b → a/,
    ],
    [
      'a CC BY licence without attribution',
      [component({ licence: { ...MIT_LICENCE, spdx: 'CC-BY-4.0' } })],
      /requires attribution/,
    ],
    ['a licence without its notice', [component({ licence: { spdx: 'MIT' } })], /licence\.notice/],
    [
      'a notice off https',
      [component({ licence: { ...MIT_LICENCE, notice: { ...MIT_LICENCE.notice, url: 'http://e.org/N' } } })],
      /https/,
    ],
    [
      'a notice without its sha256',
      [component({ licence: { ...MIT_LICENCE, notice: { url: MIT_LICENCE.notice.url, size: 10 } } })],
      /licence\.notice\.sha256/,
    ],
    [
      'a notice too big to fetch whole',
      [
        component({
          licence: { ...MIT_LICENCE, notice: { ...MIT_LICENCE.notice, size: MAX_NOTICE_BYTES + 1 } },
        }),
      ],
      /licence\.notice\.size/,
    ],
    ['a bad sha256', [component({ artifacts: [{ ...base, sha256: 'ABC' }] })], /sha256/],
    ['a plain-http URL', [component({ artifacts: [{ ...base, urls: ['http://e.org/x'] }] })], /https/],
    [
      'a file name with a slash',
      [
        component({
          artifacts: [{ ...base, install: { type: 'file', fileName: '../x' } }],
        }),
      ],
      /fileName/,
    ],
    [
      'an archive without extractedSize',
      [
        component({
          artifacts: [{ ...base, install: { type: 'archive', format: 'tar' } }],
        }),
      ],
      /extractedSize/,
    ],
    ['two artifacts for one platform', [component({ artifacts: [base, base] })], /One artifact per platform/],
  ])('rejects %s with jobs.manifest_invalid', (_, components, message) => {
    const result = parse(...components);
    expect(!result.ok && result.error.code).toBe('jobs.manifest_invalid');
    expect(failure(result)).toMatch(message);
  });

  it('only allows https URLs without credentials, plus loopback http for tests', () => {
    expect(isAllowedDownloadUrl('https://cdn.example.org/a')).toBe(true);
    expect(isAllowedDownloadUrl('http://127.0.0.1:8080/a')).toBe(true);
    expect(isAllowedDownloadUrl('http://localhost/a')).toBe(true);
    expect(isAllowedDownloadUrl('http://cdn.example.org/a')).toBe(false);
    expect(isAllowedDownloadUrl('https://user:pw@cdn.example.org/a')).toBe(false);
    expect(isAllowedDownloadUrl('ftp://cdn.example.org/a')).toBe(false);
    expect(isAllowedDownloadUrl('not a url')).toBe(false);
  });

  it('knows which licences need attribution', () => {
    expect(requiresAttribution('CC-BY-4.0')).toBe(true);
    expect(requiresAttribution('MIT OR CC-BY-SA-4.0')).toBe(true);
    expect(requiresAttribution('MIT')).toBe(false);
    expect(requiresAttribution('Apache-2.0')).toBe(false);
  });
});

describe('selection', () => {
  it('picks the platform build, else the platform-independent one', () => {
    const runtime = example.components.find((c) => c.id === 'onnxruntime')!;
    const model = example.components.find((c) => c.id === 'beat-this')!;
    expect(selectArtifact(runtime, 'darwin-arm64')?.platform).toBe('darwin-arm64');
    expect(selectArtifact(runtime, 'win32-x64')).toBeUndefined();
    expect(selectArtifact(model, 'win32-x64')?.platform).toBe('any');
  });

  it('orders installs dependencies first, each once', () => {
    const order = installOrder(
      example,
      ['reference-fetcher', 'beat-this', 'embeddinggemma-2'],
      'darwin-arm64',
    );
    expect(order.ok && order.value.map((c) => c.id)).toEqual([
      'deno',
      'reference-fetcher',
      'onnxruntime',
      'beat-this',
      'embeddinggemma-2',
    ]);
    expect(installOrder(example, ['nope'], 'darwin-arm64')).toMatchObject({
      ok: false,
      error: { code: 'jobs.component_unknown', params: { component: 'nope' } },
    });
    expect(installOrder(example, ['beat-this'], 'win32-x64')).toMatchObject({
      ok: false,
      error: {
        code: 'jobs.platform_unsupported',
        params: { component: 'onnxruntime', platform: 'win32-x64' },
      },
    });
  });

  it('chooses default components by hardware tier', () => {
    const ids = (tier: 'minimum' | 'recommended' | 'high', platform = 'darwin-arm64') =>
      componentsForTier(example, tier, platform).map((c) => c.id);
    expect(ids('minimum')).toContain('whisper-small-q8-0');
    expect(ids('minimum')).not.toContain('whisper-medium-q5-0');
    expect(ids('high')).toContain('whisper-medium-q5-0');
    expect(ids('high')).not.toContain('reference-fetcher');
    // whisper.cpp is a tier default and a dependency of the ggml models, installed before them.
    expect(ids('recommended').indexOf('whisper-cpp')).toBeLessThan(
      ids('recommended').indexOf('whisper-medium-q5-0'),
    );
    // Nothing installable on a platform with no runtimes: models that need them are skipped, not failed.
    expect(ids('high', 'linux-x64')).toEqual([]);
  });

  it('finds dependents and builds stable idempotency keys', () => {
    expect(dependentsOf(example, 'onnxruntime').map((c) => c.id)).toEqual(['embeddinggemma-2', 'beat-this']);
    const beat = example.components.find((c) => c.id === 'beat-this')!;
    expect(installIdempotencyKey(beat, beat.artifacts[0]!)).toBe(
      `components.install:beat-this@1.1.0-onnx-25308706#${'0'.repeat(64)}`,
    );
  });
});
