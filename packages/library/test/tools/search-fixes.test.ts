// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Regression tests for `library.search` multi-filename recall and 8 KiB inline payload compaction:
 * 1. Multi-filename keyword queries (12 filenames) are not dropped by `keywordCoverage: 0.5` or frame kNN noise.
 * 2. 30-hit queries stay <= 7,800 UTF-8 bytes (< 8,192 B) with every hit preserving required inline fields,
 *    and `summarize` lists top hits (`assetId`, `fileName`, `duration`).
 */
import { createHash } from 'node:crypto';
import {
  newId,
  ok,
  RationalTime,
  TimeRange,
  unwrap,
  type AnyTool,
  type CommandToolContext,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { libraryToolModule, SEARCH_FUSION_V2 } from '../../src/index';
import { shotRange } from '../../src/repositories/shots';
import { MAX_INLINE_SEARCH_BYTES } from '../../src/search/compact-hits';
import { embedText } from '../fixtures/fake-embedder';
import { analysisFor } from '../repositories/profile-helpers';
import { searchFixture } from '../search/search-helpers';

const hex = (tag: string, len: number) => createHash('sha256').update(tag).digest('hex').slice(0, len);

function makeCtx(): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async (artifact) =>
        ok({
          id: newId<'Artifact'>(),
          mediaType: artifact.mediaType,
          bytes: 1,
          summary: artifact.summary,
        }),
      get: async () => {
        throw new Error('unused');
      },
    },
    reportUsage: () => {},
    reportProgress: () => {},
    dispatch: async () => ok(undefined),
  };
}

describe('library.search multi-filename recall & 8 KiB inline budget', () => {
  it('returns all 12 exact filename matches at the top despite keywordCoverage 0.5 and frame kNN noise', async () => {
    const s = searchFixture({ deps: { fusion: SEARCH_FUSION_V2 } });
    const sourceId = s.fixture.sources[0]!;
    const rate = { num: 30_000, den: 1_001 };
    const names = Array.from(
      { length: 12 },
      (_, i) => `20261102_${String(173212 + i * 37).padStart(6, '0')}.mp4`,
    );

    for (const [i, name] of names.entries()) {
      const shotCount = i < 4 ? 3 : 1;
      const duration = RationalTime.of(300 * shotCount, rate);
      const asset = unwrap(
        s.repos.assets.create({
          kind: 'video',
          sizeBytes: 2_000_000 + i,
          originalFilename: name,
          contentHash: hex(`fn-content:${i}`, 64),
          partialHash: hex(`fn-partial:${i}`, 32),
        }),
      );
      unwrap(
        s.repos.assetLocations.add({
          assetId: asset.id,
          sourceId,
          storage: 'referenced',
          relativePath: `camera/${name}`,
          sizeBytes: asset.sizeBytes,
          state: 'present',
        }),
      );
      unwrap(
        s.repos.assets.setFacts(asset.id, {
          version: 1,
          width: 1080,
          height: 1920,
          orientation: 'portrait',
          duration,
          frameRate: rate,
          variableFrameRate: false,
          hdr: 'none',
          speed: 'normal',
          speedFactor: 1,
          retimedInFile: false,
          hasAudio: true,
        }),
      );
      const ranges = Array.from({ length: shotCount }, (_, n) =>
        TimeRange.of(RationalTime.of(n * 300, rate), RationalTime.of(300, rate)),
      );
      const shotIds = unwrap(s.repos.shots.replaceForAsset(asset.id, 0, ranges));
      unwrap(
        s.repos.shots.putAnalyses(
          shotIds.map((shotId, n) => ({
            shotId,
            analysis: {
              ...analysisFor(ranges[n]!),
              description: {
                text: `Outdoor handheld clip ${i + 1} shot ${n + 1}`,
                objects: ['person'],
                place: 'street',
                shotType: 'medium',
                model: { provider: 'fixture', model: 'fixture-vlm', local: true },
              },
            },
          })),
        ),
      );
      for (const [n, shotId] of shotIds.entries()) {
        unwrap(
          s.vectors.upsert([
            {
              id: `frame:${shotId}:0`,
              vector: embedText('completely unrelated visual scene', 0.2, 900 + i * 10 + n),
              metadata: { assetId: asset.id, sourceId, kind: 'frame' },
            },
          ]),
        );
      }
    }

    const mod = libraryToolModule({
      db: s.db,
      search: s.search,
      importStatus: async () =>
        ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    });
    const searchTool = mod.tools.find((t) => t.name === 'library.search')! as AnyTool;
    const ctx = makeCtx();

    const query = names.join(', ');
    const out = unwrap(await searchTool.run(searchTool.input.parse({ query, limit: 12 }), ctx)) as {
      hits: { fileName: string; matchedBy: string[]; score: number }[];
    };
    expect(searchTool.output.safeParse(out).success).toBe(true);
    expect(out.hits.map((h) => h.fileName)).toEqual(names);
    for (const hit of out.hits) {
      expect(hit.matchedBy).toContain('keyword');
      expect(hit.score).toBeGreaterThan(0.75);
    }

    // Stem-only query without extensions also matches all 12 clips.
    const stemQuery = names.map((n) => n.replace(/\.mp4$/, '')).join(' ');
    const byStem = unwrap(
      await searchTool.run(searchTool.input.parse({ query: stemQuery, limit: 12 }), ctx),
    ) as {
      hits: { fileName: string }[];
    };
    expect(byStem.hits.map((h) => h.fileName)).toEqual(names);
  });

  it('compacts 30 verbose hits under 7,800 UTF-8 bytes (< 8,192 B) and summarizes top hits', async () => {
    const s = searchFixture();
    // Give every shot a verbose description so 30 uncompacted hits would exceed 14 KiB.
    for (const shotIds of s.fixture.shotsByTheme.values()) {
      for (const shotId of shotIds.slice(0, 8)) {
        const shot = unwrap(s.repos.shots.get(shotId));
        const base = analysisFor(shotRange(shot));
        unwrap(
          s.repos.shots.putAnalyses([
            {
              shotId,
              analysis: {
                ...base,
                description: {
                  ...base.description!,
                  text: `${base.description?.text ?? 'Scene'} — wide cinematic handheld camera movement across sunlit coastline with warm golden reflections and crashing ocean waves`.slice(
                    0,
                    195,
                  ),
                  actions: ['walking', 'smiling'],
                },
              },
            },
          ]),
        );
      }
    }

    const mod = libraryToolModule({
      db: s.db,
      search: s.search,
      importStatus: async () =>
        ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    });
    const searchTool = mod.tools.find((t) => t.name === 'library.search')! as AnyTool;
    const out = unwrap(
      await searchTool.run(
        searchTool.input.parse({ query: 'golden sunset beach waves coastline', limit: 30 }),
        makeCtx(),
      ),
    ) as {
      hits: Array<{
        assetId: string;
        shotId: string;
        fileName: string;
        start: unknown;
        duration: unknown;
        score: number;
        matchedBy: string[];
        description?: string | null;
      }>;
    };

    expect(out.hits).toHaveLength(30);
    expect(searchTool.output.safeParse(out).success).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
    expect(bytes).toBeLessThanOrEqual(MAX_INLINE_SEARCH_BYTES);
    expect(bytes).toBeLessThan(8_192);

    for (const hit of out.hits) {
      expect(hit.assetId).toHaveLength(26);
      expect(hit.shotId).toHaveLength(26);
      expect(hit.fileName.length).toBeGreaterThan(0);
      expect(hit.start).toBeDefined();
      expect(hit.duration).toBeDefined();
      expect(typeof hit.score).toBe('number');
      expect(hit.matchedBy.length).toBeGreaterThan(0);
      expect(typeof hit.description).toBe('string');
      expect((hit.description ?? '').length).toBeGreaterThan(0);
    }

    const summary = searchTool.summarize!(out);
    expect(summary).toContain('30 shots:');
    expect(summary).toContain(out.hits[0]!.assetId);
    expect(summary).toContain(out.hits[0]!.fileName);
  });
});
