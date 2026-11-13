// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Unit tests for Hallmark thumbnail prompt and copy preflight,
 * social publishing metadata pack synthesis, and the `images.generateThumbnail`
 * tool (`publishPack` smart card across `16:9`, `9:16`, `4:5`, `1:1`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  newId,
  ok,
  parseCard,
  socialMetadataPackSchema,
  toolModuleProblems,
  type ArtifactInput,
  type GeneratedFile,
} from '@taalcut/core';
import {
  buildHallmarkThumbnailPrompt,
  buildSocialMetadataPack,
  createGenerateThumbnailTool,
  createImageProviders,
  createImageToolModule,
  createMemoryCloudCallSink,
  disableNetwork,
  evaluateHallmarkThumbnail,
  formatYoutubeTagsCsv,
  generateThumbnailInput,
  generateThumbnailOutput,
  HALLMARK_THUMBNAIL_AVOID,
  sanitizeHallmarkHook,
  sanitizeHallmarkStatBadge,
  type ImageToolDeps,
  type NetworkGuard,
} from '@taalcut/models';
import { GROK, json, keys, png, selectorOf, URLS, wire } from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const ASPECT_DIMS: Record<string, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '4:5': [1080, 1350],
  '1:1': [1080, 1080],
};

function setupThumbnailEnv(options: { enabled?: boolean } = {}) {
  const projectId = newId<'Project'>();
  const timelineId = newId<'Timeline'>();
  const net = wire({
    [URLS.openrouter]: (sent) => {
      const [w, h] = ASPECT_DIMS[String(sent.body.aspect_ratio)] ?? [1920, 1080];
      const count = Number(sent.body.n ?? 1);
      const b64 = Buffer.from(png(w, h)).toString('base64');
      return json(
        JSON.stringify({
          created: 1_728_900_000,
          data: Array.from({ length: count }, () => ({ b64_json: b64 })),
          usage: { cost: 0.04 * count },
        }),
      );
    },
  });
  const callLog = createMemoryCloudCallSink();
  const stored: GeneratedFile[] = [];
  const providers = createImageProviders({
    credentials: keys('openrouter'),
    callLog,
    localOnly: () => false,
    fetch: net.fetch,
  });
  const deps: ImageToolDeps = {
    providers,
    selector: selectorOf(GROK),
    sink: {
      async put(file) {
        stored.push(file);
        return ok({ assetId: newId<'Asset'>(), contentHash: 'h'.repeat(64), duplicate: false });
      },
    },
    timelines: {
      get: async () => {
        throw new Error('timeline store not required for standalone thumbnail generation');
      },
    },
    ...(options.enabled !== undefined ? { settings: { get: () => ({ enabled: options.enabled! }) } } : {}),
    now: () => 1_700_000_000_000,
  };

  const module = createImageToolModule(deps);
  const tool = createGenerateThumbnailTool(deps);
  const artifacts: ArtifactInput[] = [];
  const usage: unknown[] = [];
  const runId = newId<'AgentRun'>();
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId,
    attempt: 1,
    artifacts: {
      async put(artifact: ArtifactInput) {
        artifacts.push(artifact);
        return ok({
          id: newId<'Artifact'>(),
          mediaType: artifact.mediaType,
          bytes: typeof artifact.data === 'string' ? artifact.data.length : artifact.data.byteLength,
          summary: artifact.summary,
        });
      },
      get: async () => {
        throw new Error('not read');
      },
    },
    reportUsage: (u: unknown) => usage.push(u),
    reportProgress: () => {},
  };

  return { projectId, timelineId, deps, module, tool, ctx, net, stored, artifacts, usage };
}

describe('Hallmark thumbnail prompt and copy preflight', () => {
  it('enhances prompts with aspect safe zones, negative space, theme optics, and anti-slop directives', () => {
    const ytPrompt = buildHallmarkThumbnailPrompt({
      prompt: 'Weathered brass espresso lever machine steaming on a walnut counter',
      aspect: '16:9',
      archetype: 'editorial-specimen',
      theme: 'golden-hour',
      textAlign: 'bottom-left',
    });
    expect(ytPrompt).toContain('16:9 widescreen YouTube thumbnail frame (1920x1080)');
    expect(ytPrompt).toContain('bottom-right corner clear');
    expect(ytPrompt).toContain('bottom-left quadrant for crisp roman typographic overlay');
    expect(ytPrompt).toContain('Golden-hour palette');
    expect(ytPrompt).toContain(HALLMARK_THUMBNAIL_AVOID);

    const verticalPrompt = buildHallmarkThumbnailPrompt({
      prompt: 'Potter shaping wet stoneware clay on a spinning wheel',
      aspect: '9:16',
      archetype: 'atmospheric-cinema',
      theme: 'midnight',
      textAlign: 'top-left',
    });
    expect(verticalPrompt).toContain('9:16 vertical Shorts/Reels/TikTok cover frame (1080x1920)');
    expect(verticalPrompt).toContain('right-rail action icon zone');
    expect(verticalPrompt).toContain('central 4:5 profile grid crop');
    expect(verticalPrompt).toContain('top-left quadrant');
    expect(verticalPrompt).toContain('Midnight palette');
  });

  it('preserves scene-specific art direction and crop constraints for long briefs', () => {
    const prompt = buildHallmarkThumbnailPrompt({
      prompt: 'Airport city lights from an airplane window. '.repeat(100),
      aspect: '9:16',
      archetype: 'atmospheric-cinema',
      theme: 'midnight',
    });
    expect(prompt.length).toBeLessThanOrEqual(2000);
    expect(prompt).toContain('Airport city lights from an airplane window');
    expect(prompt).toContain('central 4:5 profile grid crop');
    expect(prompt).toContain(HALLMARK_THUMBNAIL_AVOID);
    expect(prompt).not.toMatch(/film grain|shallow depth|35mm|volumetric/);
  });

  it('sanitizes copy without claiming that the rendered design passed visual review', () => {
    expect(sanitizeHallmarkHook('*48 HOURS IN OLD JAIPUR BEFORE SUNRISE AT DAWN!!!*')).toBe(
      '48 HOURS IN OLD JAIPUR BEFORE',
    );
    expect(sanitizeHallmarkHook('Why This Lens Works.')).toBe('Why This Lens Works');

    // Fake engagement metrics are stripped per Hallmark zero-invented-metrics rule
    expect(sanitizeHallmarkStatBadge('10M VIEWS')).toBeUndefined();
    expect(sanitizeHallmarkStatBadge('99.9%')).toBeUndefined();
    expect(sanitizeHallmarkStatBadge('100X')).toBeUndefined();

    // Real timeline/camera facts are preserved
    expect(sanitizeHallmarkStatBadge('14 SHOTS')).toBe('14 SHOTS');
    expect(sanitizeHallmarkStatBadge('4K RAW')).toBe('4K RAW');
    expect(sanitizeHallmarkStatBadge('DAY 2')).toBe('DAY 2');
    expect(sanitizeHallmarkStatBadge('0:42')).toBe('0:42');

    const cleanEval = evaluateHallmarkThumbnail({
      prompt: 'Sandstone courtyard in Jaipur at dawn with warm directional key light',
      hookText: '48 HOURS IN JAIPUR',
      kickerText: 'OLD CITY · DAWN',
      statBadge: '14 SHOTS',
      durationBadge: '0:42',
      aspect: '16:9',
      archetype: 'editorial-specimen',
      theme: 'golden-hour',
      textAlign: 'bottom-left',
    });
    expect(cleanEval.passed).toBe(false);
    expect(cleanEval.philosophy).toBe(5);
    expect(cleanEval.hierarchy).toBe(5);
    expect(cleanEval.execution).toBeLessThan(4);
    expect(cleanEval.specificity).toBe(5);
    expect(cleanEval.restraint).toBe(5);
    expect(cleanEval.variety).toBeLessThan(4);
    expect(cleanEval.warnings).toContainEqual(expect.stringContaining('Visual review required'));
    expect(cleanEval.statBadge).toBe('14 SHOTS');

    const sanitizedEval = evaluateHallmarkThumbnail({
      prompt: 'Night street market in Tokyo with rain reflections on asphalt',
      hookText: '*TOKYO AT MIDNIGHT WITH ONE PRIME LENS IN HEAVY RAIN!!!*',
      statBadge: '10M VIEWS',
    });
    expect(sanitizedEval.hookText).toBe('TOKYO AT MIDNIGHT WITH ONE PRIME');
    expect(sanitizedEval.statBadge).toBeUndefined();
    expect(sanitizedEval.passed).toBe(false);
    expect(sanitizedEval.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('buildSocialMetadataPack', () => {
  it('builds validated YouTube (title, chapters at 00:00, comma-separable tags), Instagram, and TikTok metadata', () => {
    const pack = buildSocialMetadataPack({
      hookText: '48 HOURS IN JAIPUR',
      kickerText: 'OLD CITY · DAWN',
      prompt: 'Walking Jaipur pink sandstone streets before sunrise with a 35mm lens',
      statBadge: '14 SHOTS',
      channel: { name: 'Aarav Field Notes', handle: '@aaravfieldnotes' },
      chapters: [
        { timecode: '0:18', label: 'Hawa Mahal facade in first light' },
        { timecode: '01:05', label: 'Amer Fort stepwell geometry' },
      ],
      instagram: {
        hashtags: ['#Jaipur', 'RajasthanTravel', '#Cinematography'],
      },
    });

    expect(socialMetadataPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.researchSummary.length).toBeGreaterThanOrEqual(2);
    expect(pack.youtube.title.length).toBeLessThanOrEqual(100);
    expect(pack.youtube.titleAlternates.length).toBeGreaterThanOrEqual(2);
    // Chapters always start at 00:00
    expect(pack.youtube.chapters[0]?.timecode).toBe('00:00');
    expect(pack.youtube.chapters[1]).toEqual({
      timecode: '00:18',
      label: 'Hawa Mahal facade in first light',
    });
    expect(pack.youtube.description).toContain('00:00');
    expect(pack.youtube.description).toContain('Aarav Field Notes');
    expect(pack.youtube.tags.length).toBeGreaterThanOrEqual(8);
    const csvTags = formatYoutubeTagsCsv(pack.youtube.tags);
    expect(csvTags).toContain(', ');

    // Instagram hashtags have no duplicate '#' prefix
    expect(pack.instagram.hashtags.length).toBeGreaterThanOrEqual(5);
    for (const tag of pack.instagram.hashtags) {
      expect(tag.startsWith('#')).toBe(false);
    }

    // TikTok metadata has caption, SEO keywords, and hashtags
    expect(pack.tiktok.caption.length).toBeGreaterThan(10);
    expect(pack.tiktok.seoKeywords.length).toBeGreaterThanOrEqual(3);
    expect(pack.tiktok.hashtags.length).toBeGreaterThanOrEqual(4);
  });
});

describe('images.generateThumbnail tool', () => {
  it('converts input and output schemas cleanly to JSON Schema and passes toolModuleProblems', () => {
    const { module } = setupThumbnailEnv();
    expect(toolModuleProblems(module)).toEqual([]);
    for (const schema of [generateThumbnailInput, generateThumbnailOutput] as const) {
      for (const io of ['input', 'output'] as const) {
        expect(() =>
          z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'throw' }),
        ).not.toThrow();
      }
    }
  });

  it('generates 16:9 and 9:16 Hallmark variants, preserves channel profile, and emits a valid publishPack card', async () => {
    const env = setupThumbnailEnv();
    const input = env.tool.input.parse({
      projectId: env.projectId,
      timelineId: env.timelineId,
      prompt: 'Artisan pouring latte art in a sunlit ceramic studio, shallow depth of field',
      aspects: ['16:9', '9:16'],
      archetype: 'editorial-specimen',
      theme: 'golden-hour',
      hookText: 'MORNING ESPRESSO RITUAL!',
      kickerText: 'STUDIO NOTES',
      statBadge: '12 SHOTS',
      durationBadge: '0:38',
      textAlign: 'bottom-left',
      channel: {
        name: 'Kavi Studio',
        handle: '@kavistudio',
        showOnThumbnail: true,
      },
      social: {
        youtube: {
          chapters: [
            { timecode: '00:00', label: 'Dialing in the grind' },
            { timecode: '00:19', label: 'Steaming microfoam texture' },
          ],
        },
      },
    });

    expect(env.tool.estimateCost?.(input).billed).toEqual({ unit: 'image', quantity: 2 });

    const res = await env.tool.run(input, env.ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const out = env.tool.output.parse(res.value);
    expect(out.thumbnails).toHaveLength(2);
    expect(out.thumbnails.map((v) => [v.aspect, v.platform])).toEqual([
      ['16:9', 'youtube'],
      ['9:16', 'shorts'],
    ]);
    expect(out.thumbnails[0]?.hookText).toBe('MORNING ESPRESSO RITUAL');
    expect(out.thumbnails[0]?.statBadge).toBe('12 SHOTS');
    expect(out.thumbnails.every((variant) => !variant.hallmark.passed)).toBe(true);
    expect(out.reviewNote).toContain('Execution and variety remain unreviewed');
    expect(out.reviewNote).toContain('save the composed cover');
    expect(out.channel).toEqual({
      name: 'Kavi Studio',
      handle: '@kavistudio',
      showOnThumbnail: true,
    });
    expect(env.stored).toHaveLength(2);
    expect(env.artifacts).toHaveLength(2);

    // Validate the emitted publishPack smart card via core's parseCard
    const parsedDirect = parseCard(out.resultCard);
    expect(parsedDirect.ok).toBe(true);
    if (parsedDirect.ok) {
      expect(parsedDirect.value.type).toBe('publishPack');
    }

    const fromHook = await env.tool.resultCard?.(out, {
      runId: env.ctx.runId,
      toolCallId: env.ctx.callId,
      projectId: env.projectId,
      signal: env.ctx.signal,
    });
    expect(fromHook?.ok && parseCard(fromHook.value).ok).toBe(true);
  });

  it('preserves complete composition mode through generation, output and the publishing card', async () => {
    const env = setupThumbnailEnv();
    const result = await env.tool.run(
      env.tool.input.parse({
        projectId: env.projectId,
        prompt: 'Oversized lettering, orange underline and an illustrated flight path',
        medium: 'mixed',
        composition: 'complete',
        aspects: ['9:16'],
        hookText: 'Never gets old.',
        channel: { handle: '@taalcut.app' },
      }),
      env.ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = env.tool.output.parse(result.value);
    expect(out.thumbnails[0]).toMatchObject({ composition: 'complete', hookText: 'Never gets old.' });
    expect(out.resultCard.thumbnails[0]?.composition).toBe('complete');
    expect(JSON.stringify(env.net.sent)).toContain('complete composition');
    expect(JSON.stringify(env.net.sent)).toContain('@taalcut.app');
  });

  it('returns ImageGenerationOff when settings.get().enabled is false', async () => {
    const env = setupThumbnailEnv({ enabled: false });
    const input = env.tool.input.parse({
      projectId: env.projectId,
      prompt: 'Minimal desk setup with mechanical keyboard',
      hookText: 'CLEAN DESK BUILD',
    });
    const res = await env.tool.run(input, env.ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('models.image_no_provider');
    }
    expect(env.net.sent).toHaveLength(0);
  });
});
