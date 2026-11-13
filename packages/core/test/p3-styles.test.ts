// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Style v1, looks and the styles namespace (P3-V10, P3-V17). */
import { describe, expect, it } from 'vitest';
import {
  BAKE_GRADE_JOB_KIND,
  bakeGradeJobInputSchema,
  bakeGradeJobOutputSchema,
  DEFAULT_STYLE_SETTING,
  err,
  fontMatchSchema,
  LOGO_LIMITS,
  lookStatsSchema,
  MAX_TEXT_STYLES,
  MEASURE_LOOK_JOB_KIND,
  measureLookJobInputSchema,
  measureLookJobOutputSchema,
  newId,
  NotFoundError,
  ok,
  STYLE_COMMANDS,
  styleCommandPayloads,
  styleGradeSchema,
  styleInputSchema,
  styleProblems,
  styleSchema,
  styleSummarySchema,
  stylesContract,
  stylesRouter,
  type StyleSummary,
} from '@taalcut/core';
import { issuePaths, json, SHA, span } from './helpers/documents';
import { look, serve, style, styleInput } from './helpers/phase3';

describe('Style v1', () => {
  it('parses a brand kit and survives a JSON round trip', () => {
    const doc = style();
    expect(styleSchema.parse(json(doc))).toEqual(json(doc));
    expect(styleInputSchema.safeParse(styleInput()).success).toBe(true);
  });

  it('refuses bad colours, fonts, logos, watermarks and bumpers', () => {
    const base = styleInput();
    const bad = {
      ...base,
      colours: { ...base.colours, primary: '#FFF' },
      fonts: { ...base.fonts, body: { family: 'comicSans', weight: 450 } },
      logo: base.logo && { ...base.logo, width: LOGO_LIMITS.pixels + 1, scale: 0.5 },
      watermark: { kind: 'text', text: ' ', placement: 'middle', opacity: 0.9 },
      intro: {
        kind: 'card',
        text: 'Hi',
        duration: { value: 5, rate: { num: 1, den: 1 } },
        background: 'accent',
      },
    };
    expect(issuePaths(styleInputSchema, bad)).toEqual(
      expect.arrayContaining([
        'colours.primary',
        'fonts.body.family',
        'fonts.body.weight',
        'logo.width',
        'logo.scale',
        'watermark.text',
        'watermark.placement',
        'watermark.opacity',
        'intro.duration',
        'intro.background',
      ]),
    );
  });

  it('caps text styles and keys them by styleKey', () => {
    const textLook = styleInput().textStyles.title!;
    const many = Object.fromEntries(
      Array.from({ length: MAX_TEXT_STYLES + 1 }, (_, i) => [`key${i}`, textLook]),
    );
    expect(styleInputSchema.safeParse({ ...styleInput(), textStyles: many }).success).toBe(false);
    expect(
      styleInputSchema.safeParse({ ...styleInput(), textStyles: { 'Not-a-key': textLook } }).success,
    ).toBe(false);
  });

  it('a clip bumper names an asset and an optional range', () => {
    const intro = { kind: 'clip', assetId: newId<'Asset'>(), range: span(0, 30) };
    expect(
      styleInputSchema.safeParse({ ...styleInput(), intro, outro: { ...intro, range: null } }).success,
    ).toBe(true);
  });

  it('a logo watermark needs a logo', () => {
    expect(styleProblems(styleInput())).toEqual([]);
    expect(styleProblems({ ...styleInput(), logo: null })).toEqual(['watermark.logoMissing']);
    expect(
      styleProblems({
        logo: null,
        watermark: { kind: 'text', text: 'me', placement: 'topLeft', opacity: 0.3 },
      }),
    ).toEqual([]);
  });
});

describe('looks', () => {
  it('a grade and a font match join the Style', () => {
    const grade = {
      version: 1,
      target: look(),
      strength: 0.6,
      cubeSize: 33,
      source: { kind: 'template', templateId: newId<'Template'>(), version: 2 },
      measuredAt: 0,
    };
    const fontMatch = {
      version: 1,
      family: 'anton',
      score: 0.71,
      metric: 'ssim',
      script: 'latin',
      ranking: [{ family: 'anton', score: 0.71 }],
      sampleText: 'DAY ONE',
      ocrConfidence: 0.9,
    };
    expect(styleGradeSchema.safeParse(grade).success).toBe(true);
    expect(fontMatchSchema.safeParse(fontMatch).success).toBe(true);
    const madeFrom = { templateId: newId<'Template'>(), version: 1 };
    const doc = { ...style(), kind: 'look', grade, fontMatch, madeFrom };
    expect(styleSchema.parse(json(doc))).toMatchObject({
      grade: { cubeSize: 33 },
      fontMatch: { family: 'anton' },
    });
  });

  it('refuses statistics and grades out of range', () => {
    expect(issuePaths(lookStatsSchema, { ...look(), std: [0, 1, 1], frames: 65 })).toEqual([
      'std.0',
      'frames',
    ]);
    const asset = { kind: 'asset', assetId: newId<'Asset'>(), range: span(0, 30) };
    expect(
      issuePaths(styleGradeSchema, {
        version: 1,
        target: look(),
        strength: 1.5,
        cubeSize: 64,
        source: asset,
        measuredAt: 0,
      }),
    ).toEqual(['strength', 'cubeSize']);
    expect(fontMatchSchema.safeParse({ family: 'anton', score: 2 }).success).toBe(false);
  });

  it("names vision's look jobs and their payloads", () => {
    expect([MEASURE_LOOK_JOB_KIND, BAKE_GRADE_JOB_KIND]).toEqual(['vision.measureLook', 'vision.bakeGrade']);
    const assetId = newId<'Asset'>();
    expect(measureLookJobInputSchema.safeParse({ assetId, range: span(0, 60) }).success).toBe(true);
    expect(measureLookJobOutputSchema.safeParse({ look: look() }).success).toBe(true);
    const input = { assetId, range: span(0, 60), target: look(), strength: 0.5, cubeSize: 17 };
    expect(bakeGradeJobInputSchema.safeParse(input).success).toBe(true);
    expect(bakeGradeJobInputSchema.safeParse({ ...input, cubeSize: 32 }).success).toBe(false);
    const lut = {
      kind: 'gradeLut',
      key: `grades/ab/${'a'.repeat(64)}.s17.v1.cube`,
      bytes: 9,
      mimeType: 'text/plain',
      recipe: 1,
    };
    expect(bakeGradeJobOutputSchema.safeParse({ lut }).success).toBe(true);
    expect(bakeGradeJobOutputSchema.safeParse({ lut: { ...lut, key: 'x' } }).success).toBe(false);
  });
});

describe('style commands', () => {
  const styleId = newId<'Style'>();

  it('are app-wide and validate their payloads', () => {
    const create = styleCommandPayloads[STYLE_COMMANDS.create].parse({ styleId, style: styleInput() });
    expect(create.projectId).toBeNull();
    const update = styleCommandPayloads[STYLE_COMMANDS.update];
    expect(update.safeParse({ styleId, baseRevision: 1, patch: { name: 'New' } }).success).toBe(true);
    expect(update.safeParse({ styleId, baseRevision: 1, patch: {} }).success).toBe(false);
    expect(update.safeParse({ styleId, baseRevision: 1, patch: { kind: 'look' } }).success).toBe(false);
    expect(styleCommandPayloads[STYLE_COMMANDS.rename].safeParse({ styleId, name: ' ' }).success).toBe(false);
    expect(styleCommandPayloads[STYLE_COMMANDS.remove].safeParse({ styleId }).success).toBe(true);
    expect(styleCommandPayloads[STYLE_COMMANDS.setDefault].safeParse({ styleId: null }).success).toBe(true);
    expect(styleCommandPayloads[STYLE_COMMANDS.restore].safeParse({ styleId, style: null }).success).toBe(
      true,
    );
    expect(styleCommandPayloads[STYLE_COMMANDS.restore].safeParse({ styleId, style: style() }).success).toBe(
      true,
    );
    expect(STYLE_COMMANDS.remove).toBe('style.delete');
  });

  it('the default style setting is off until chosen', () => {
    expect(DEFAULT_STYLE_SETTING).toMatchObject({ key: 'styles.default', defaultValue: null });
    expect(DEFAULT_STYLE_SETTING.schema.safeParse(styleId).success).toBe(true);
    expect(DEFAULT_STYLE_SETTING.schema.safeParse('kit').success).toBe(false);
  });
});

describe('styles namespace', () => {
  it('serves the list, a style, its usage and an imported image', async () => {
    const doc = style();
    const summary: StyleSummary = {
      id: doc.id,
      name: doc.name,
      kind: doc.kind,
      revision: 1,
      colours: doc.colours,
      logo: { asset: SHA, mediaType: 'image/png', width: 512, height: 512 },
      isDefault: true,
      updatedAt: 0,
    };
    expect(styleSummarySchema.safeParse(summary).success).toBe(true);
    const paths: string[] = [];
    const client = serve(
      stylesContract,
      stylesRouter({
        list: async () => ok([summary]),
        get: async (styleId) => (styleId === doc.id ? ok(doc) : err(NotFoundError({ entity: 'style' }))),
        usedBy: async () => ok({ timelines: 2, templates: 1 }),
        importImage: async (path) => (
          paths.push(path),
          ok({ sha256: SHA, mediaType: 'image/webp', width: 64, height: 64 })
        ),
      }),
    );
    expect(await client.list()).toEqual([summary]);
    expect((await client.get({ styleId: doc.id })).name).toBe('Goa kit');
    await expect(client.get({ styleId: newId<'Style'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    expect(await client.usedBy({ styleId: doc.id })).toEqual({ timelines: 2, templates: 1 });
    expect(await client.importImage({ path: '/Users/me/logo.webp' })).toMatchObject({ sha256: SHA });
    expect(paths).toEqual(['/Users/me/logo.webp']);
    await expect(client.importImage({ path: '' })).rejects.toBeDefined();
  });
});
