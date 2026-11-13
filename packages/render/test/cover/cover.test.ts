// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createCommandBus,
  createMemoryAuditLogStore,
  createManualClock,
  coverSettingsSchema,
  newId,
  ok,
} from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { coverBundle } from '../../src/cover/cover-bundle';
import { createCoverExportCommand } from '../../src/cover/cover-command';
import { airportDesign } from './authored-fixture';
import { makeTimeline } from '../support/timeline';

it('cover design is deterministic, original media is linked, and text cannot add markup or scripts', () => {
  const cover = coverSettingsSchema.parse({
    aspect: '4:5',
    source: { kind: 'frame', frame: 3 },
    hookText: '<script>hi</script>',
  });
  const bundle = coverBundle(cover, '/original.jpg', '/fonts');
  expect(bundle).toEqual(coverBundle(cover, '/original.jpg', '/fonts'));
  expect(bundle.links['backdrop.jpg']?.source).toBe('/original.jpg');
  expect(bundle.files['index.html']).toContain('data-width="1080" data-height="1350"');
  expect(bundle.files['index.html']).toContain('&lt;script&gt;hi&lt;/script&gt;');
  expect(bundle.files['index.html']).not.toContain('<script>hi</script>');
  expect(Object.values(bundle.links).every((link) => !link.source.startsWith('https:'))).toBe(true);
});

it('authored layers escape copy, link only their pinned fonts and apply explicit backdrop crop', () => {
  const design = airportDesign();
  if (design.layers[0]?.kind === 'text') design.layers[0].text = '<script>alert(1)</script>';
  design.backdrop = { fit: 'contain', x: 0.8, y: 0.3 };
  const bundle = coverBundle(
    coverSettingsSchema.parse({
      aspect: '9:16',
      source: { kind: 'asset', assetId: newId<'Asset'>() },
      design,
    }),
    '/photo.jpg',
    '/fonts',
  );
  expect(bundle.files['index.html']).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(bundle.files['index.html']).not.toContain('<script>alert(1)</script>');
  expect(bundle.files['cover.css']).toContain('object-fit:contain;object-position:80% 30%');
  expect(bundle.files['cover.css']).toContain('font-family:var(--font-montserrat)');
  expect(bundle.files['cover.css']).toContain('text-shadow:0 2px 6px rgba(0,0,0,.55)');
  expect(Object.keys(bundle.links).some((file) => file.toLowerCase().includes('montserrat'))).toBe(true);
});

it('a complete artwork without overlay copy has no empty preset decoration', () => {
  const cover = coverSettingsSchema.parse({
    aspect: '9:16',
    source: { kind: 'asset', assetId: newId<'Asset'>() },
    archetype: 'minimal-frame',
  });
  const bundle = coverBundle(cover, '/complete.jpg', '/fonts');
  expect(bundle.files['index.html']).not.toContain('class="words"');
  expect(bundle.files['index.html']).not.toContain('class="scrim"');
});

describe('cover export command', () => {
  it('optionally registers the exact source-frame cover as a reusable library image', async () => {
    const timeline = makeTimeline({ items: [{ frames: 60 }] });
    const assetId = newId<'Asset'>();
    const bytes = Buffer.from('source-frame-cover');
    const put = vi.fn(async () => ok({ assetId, contentHash: 'f'.repeat(64), duplicate: false }));
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });
    bus.register(
      createCoverExportCommand({
        files: { write: vi.fn(), writeBytes: async () => ok({ fileName: 'cover.jpg' }) },
        worker: {
          coverImage: async () =>
            ok({
              mimeType: 'image/jpeg',
              dataBase64: bytes.toString('base64'),
              width: 1080,
              height: 1920,
              revision: timeline.revision,
            }),
          captureFrame: vi.fn(),
          export: vi.fn(),
        },
        timelines: { get: async () => ok(timeline), update: vi.fn() },
        generatedAssets: { put },
        clock: createManualClock(123),
      }),
    );
    const result = await bus.dispatch(
      'render.exportCover',
      { projectId: timeline.projectId, timelineId: timeline.id, revision: timeline.revision },
      { source: 'ui', actor: 'user' },
      { idempotencyKey: newId() },
    );
    expect(result.ok && result.value.result).toMatchObject({ assetId, fileName: 'cover.jpg' });
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes,
        mediaType: 'image/jpeg',
        provenance: expect.objectContaining({
          generation: 'workspace',
          model: 'source-frame-cover',
          createdAt: 123,
        }),
      }),
    );
  });

  it('writes the renderer’s exact full-resolution bytes and returns only the file receipt', async () => {
    const timeline = makeTimeline({ items: [{ frames: 60 }] });
    const image = {
      mimeType: 'image/jpeg' as const,
      dataBase64: Buffer.from('full-resolution-image').toString('base64'),
      width: 1920,
      height: 1080,
      revision: timeline.revision,
    };
    const writeBytes = vi.fn(async () => ok({ fileName: 'cover.jpg' }));
    const coverImage = vi.fn(async () => ok(image));
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });
    bus.register(
      createCoverExportCommand({
        files: { write: async () => ok({ fileName: 'unused' }), writeBytes },
        worker: { coverImage, captureFrame: vi.fn(), export: vi.fn() },
        timelines: { get: async () => ok(timeline), update: vi.fn() },
      }),
    );
    const input = { projectId: timeline.projectId, timelineId: timeline.id, revision: timeline.revision };
    const result = await bus.dispatch(
      'render.exportCover',
      input,
      { source: 'ui', actor: 'user' },
      { idempotencyKey: newId() },
    );
    expect(result.ok).toBe(true);
    expect(coverImage).toHaveBeenCalledWith(input);
    expect(writeBytes).toHaveBeenCalledWith(
      expect.objectContaining({ extension: '.jpg', bytes: Buffer.from('full-resolution-image') }),
    );
    if (result.ok)
      expect(result.value.result).toEqual({
        fileName: 'cover.jpg',
        width: 1920,
        height: 1080,
        revision: timeline.revision,
      });
  });
});
