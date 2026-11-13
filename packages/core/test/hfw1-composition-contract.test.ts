// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1's contract, the records: a composition the AI designed, a graphic drawn with one, a timeline's and a
 * template's copies, a workspace revision, and the path rules and hash every lane shares. HFW1 retire: a graphic is
 * a composition's, and a template's use names one; a timeline or template with no graphics still parses.
 */
import { describe, expect, it } from 'vitest';
import {
  compositionFor,
  compositionHash,
  compositionHashInput,
  graphicComponentsSchema,
  graphicCompositionSchema,
  graphicItemSchema,
  graphicWords,
  MAX_TIMELINE_COMPOSITIONS,
  newId,
  templateGraphicsSchema,
  timelineSchema,
  WORKSPACE_LIMITS,
  workspaceBlobPath,
  templateBlobPath,
  TEMPLATE_BLOBS_SCOPE,
  workspacePathSchema,
  workspaceRevisionSchema,
  type GraphicItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { at, json, ntscTimeline, T0 } from './helpers/documents';
import { COMPOSITION, FILES as files, ntsc, sha } from './helpers/hfw1';

const bare = {
  type: 'graphic',
  id: newId<'TimelineItem'>(),
  anchor: { kind: 'time', at: at(70, ntsc) },
  start: at(70, ntsc),
  duration: at(60, ntsc),
  placement: 'bottom',
  language: 'en',
  origin: 'agent',
} as const;
const designed = {
  ...bare,
  styleKey: 'graphic',
  composition: { id: COMPOSITION.id, hash: COMPOSITION.hash, params: { message: 'Leaving in five' } },
} as const;

type Text = Extract<Track, { kind: 'text' }>;
function withGraphic(item: GraphicItem, copies: readonly object[] = [COMPOSITION]): Timeline {
  const timeline = ntscTimeline();
  const text = timeline.tracks[2] as Text;
  return {
    ...timeline,
    tracks: [timeline.tracks[0]!, timeline.tracks[1]!, { ...text, items: [...text.items, item] }],
    graphicCompositions: copies.map((copy) => graphicCompositionSchema.parse(copy)),
  };
}

describe('HFW1: a composition (contract)', () => {
  it('round-trips, and names its entry among its files', () => {
    const parsed = graphicCompositionSchema.parse(COMPOSITION);
    expect(graphicCompositionSchema.parse(json(parsed))).toEqual(parsed);
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, entry: 'other.html' }).success).toBe(false);
  });

  it('keeps to the limits: 32 files of 64 KB, 16 variables named once, 0.5 to 600 s', () => {
    const many = Array.from({ length: 33 }, (_, n) => ({ path: `f${n}.css`, sha256: sha('d'), bytes: 1 }));
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, files: [...files, ...many] }).success).toBe(
      false,
    );
    const big = { ...files[0]!, bytes: WORKSPACE_LIMITS.fileBytes + 1 };
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, files: [big] }).success).toBe(false);
    const twice = [COMPOSITION.variables[0], COMPOSITION.variables[0]];
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, variables: twice }).success).toBe(false);
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, files: [...files, files[1]] }).success).toBe(
      false,
    );
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, durationSeconds: 0.4 }).success).toBe(false);
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, durationSeconds: 21.1 }).success).toBe(true);
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, durationSeconds: 601 }).success).toBe(false);
    expect(graphicCompositionSchema.safeParse({ ...COMPOSITION, hash: 'not-a-hash' }).success).toBe(false);
  });
});

describe('HFW1: a graphic drawn with a composition (contract)', () => {
  it('round-trips, and its words are its first text variable', () => {
    const parsed = graphicItemSchema.parse(designed);
    expect(graphicItemSchema.parse(json(parsed))).toEqual(parsed);
    expect(graphicWords(parsed, [graphicCompositionSchema.parse(COMPOSITION)])).toBe('Leaving in five');
    const unset = { ...parsed, composition: { ...parsed.composition, params: {} } };
    expect(graphicWords(unset, [graphicCompositionSchema.parse(COMPOSITION)])).toBe('Are we there yet?');
    expect(graphicWords(parsed)).toBeNull();
  });

  it('is a composition’s: none is refused, and a kit’s fields or a component beside one are dropped', () => {
    expect(graphicItemSchema.safeParse({ ...bare, styleKey: 'graphic' }).success).toBe(false);
    const component = { id: 'made-up', version: 1, params: {} };
    const parsed = graphicItemSchema.parse({ ...designed, component, fields: { text: 'Made-up words' } });
    expect(parsed).not.toHaveProperty('component');
    expect(parsed).not.toHaveProperty('fields');
  });

  it('may name the overlay it draws and whose words it shows (BRK1-GFX)', () => {
    const overlay = { id: newId<'TextOverlay'>(), words: 'editor' } as const;
    expect(graphicItemSchema.parse({ ...designed, overlay }).overlay).toEqual(overlay);
    expect(graphicItemSchema.safeParse({ ...designed, overlay: { ...overlay, words: 'kit' } }).success).toBe(
      false,
    );
  });
});

describe('HFW1: a timeline’s composition copies (contract)', () => {
  it('a timeline keeps the copies its graphics name, and round-trips', () => {
    const timeline = timelineSchema.parse(withGraphic(designed as GraphicItem));
    expect(timelineSchema.parse(json(timeline))).toEqual(timeline);
    const item = (timeline.tracks[2] as Text).items.at(-1) as GraphicItem;
    expect(compositionFor(item.composition, timeline.graphicCompositions)?.name).toBe('Message bubble');
  });

  it('each copy once by id and hash, and by id and version; at most 48', () => {
    expect(MAX_TIMELINE_COMPOSITIONS).toBe(48);
    const again = withGraphic(designed as GraphicItem, [COMPOSITION, COMPOSITION]);
    expect(timelineSchema.safeParse(again).success).toBe(false);
    const sameVersion = withGraphic(designed as GraphicItem, [
      COMPOSITION,
      { ...COMPOSITION, hash: sha('e') },
    ]);
    expect(timelineSchema.safeParse(sameVersion).success).toBe(false);
    const next = withGraphic(designed as GraphicItem, [
      COMPOSITION,
      { ...COMPOSITION, hash: sha('e'), version: 2 },
    ]);
    expect(timelineSchema.safeParse(next).success).toBe(true);
  });

  it('a timeline from before HFW1 parses without copies', () => {
    const old = ntscTimeline();
    expect(timelineSchema.parse(old).graphicCompositions).toBeUndefined();
  });
});

describe('HFW1: a template’s compositions (contract)', () => {
  const overlayId = newId<'TextOverlay'>();
  const graphics = { compositions: [COMPOSITION], uses: [{ overlayId, compositionId: COMPOSITION.id }] };

  it('holds compositions, and a use names one', () => {
    const parsed = templateGraphicsSchema.parse(graphics);
    expect(templateGraphicsSchema.parse(json(parsed))).toEqual(parsed);
    expect(graphicComponentsSchema.safeParse(graphics).success).toBe(true);
    expect(
      templateGraphicsSchema.safeParse({ ...graphics, uses: [{ overlayId, compositionId: newId() }] })
        .success,
    ).toBe(false);
    expect(
      templateGraphicsSchema.safeParse({ ...graphics, compositions: [COMPOSITION, COMPOSITION] }).success,
    ).toBe(false);
  });

  it('a use names a composition; each overlay once', () => {
    expect(templateGraphicsSchema.safeParse({ ...graphics, uses: [{ overlayId }] }).success).toBe(false);
    const twice = { overlayId, compositionId: COMPOSITION.id };
    expect(templateGraphicsSchema.safeParse({ ...graphics, uses: [twice, twice] }).success).toBe(false);
  });

  it('a template’s graphics with nothing designed parse with no compositions and no uses', () => {
    expect(templateGraphicsSchema.parse({})).toEqual({ uses: [] });
  });
});

describe('HFW1: workspace paths, revisions and the hash (contract)', () => {
  it('a path is relative and plain', () => {
    for (const path of [
      'index.html',
      'bubble/style.css',
      'assets/' + sha('f'),
      '_taalcut/brief.md',
      'a-b_c.v2.js',
    ])
      expect(workspacePathSchema.safeParse(path).success, path).toBe(true);
    for (const path of [
      '',
      '/etc/passwd',
      '../outside.html',
      'bubble/../../x',
      './index.html',
      '.hidden',
      'a//b',
      'a/',
      'a\\b',
      'C:/x',
      'é.html',
      'a/b/c/d/e/f/g/h/i.html',
      'x'.repeat(161),
    ])
      expect(workspacePathSchema.safeParse(path).success, path).toBe(false);
  });

  it('a revision round-trips, its paths once and under the workspace’s bytes', () => {
    const revision = {
      projectId: newId<'Project'>(),
      revision: 2,
      base: 1,
      files,
      createdAt: T0,
      origin: 'agent',
    };
    const parsed = workspaceRevisionSchema.parse(revision);
    expect(workspaceRevisionSchema.parse(json(parsed))).toEqual(parsed);
    expect(workspaceRevisionSchema.safeParse({ ...revision, files: [...files, files[0]] }).success).toBe(
      false,
    );
    expect(workspaceRevisionSchema.safeParse({ ...revision, base: 2 }).success).toBe(false);
    expect(workspaceRevisionSchema.safeParse({ ...revision, revision: 0, base: 0 }).success).toBe(false);
    const full = Array.from({ length: 33 }, (_, n) => ({
      path: `f${n}.png`,
      sha256: sha('a'),
      bytes: 65_536,
    }));
    expect(workspaceRevisionSchema.safeParse({ ...revision, files: full }).success).toBe(false);
  });

  it('the hash is sha256 over the files sorted by path, whatever their order', async () => {
    expect(compositionHashInput(files)).toBe(
      `bubble/index.html\0${sha('a')}\nbubble/style.css\0${sha('b')}\n`,
    );
    const hash = await compositionHash(files);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await compositionHash([...files].reverse())).toBe(hash);
    // sha256 of the empty string.
    expect(await compositionHash([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('a blob lives under its project, by its hash', () => {
    const projectId = newId<'Project'>();
    expect(workspaceBlobPath(projectId, sha('a'))).toBe(`workspaces/${projectId}/blobs/aa/${sha('a')}`);
    expect(() => workspaceBlobPath('../x', sha('a'))).toThrow();
    // HFW1-TPL: the templates' pool, under a folder no project id can name.
    expect(templateBlobPath(sha('a'))).toBe(`workspaces/templates/blobs/aa/${sha('a')}`);
    expect(TEMPLATE_BLOBS_SCOPE).not.toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(() => templateBlobPath('../x')).toThrow();
    expect(() => workspaceBlobPath(projectId, '../../x')).toThrow();
  });
});
