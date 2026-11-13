// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-2: the hub share gate refuses a private key at any depth, the hub documents convert to JSON Schema and
 * agree on ids, an id is never mistaken for a phone number, and the hub entry has no side effect.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  HUB_ID_PATHS,
  hubContentProblems,
  hubIndexEntrySchema,
  hubIndexSchema,
  hubTemplateV0Schema,
  newId,
} from '@taalcut/core';
import { json } from './helpers/documents';
import { runtimeModules } from './helpers/import-graph';
import { hubTemplate } from './helpers/phase3';

const PATH = '/Users/priya/Movies/wedding.mov';
const LOWER = '01arz3ndektsv4rrffq69g5fav';
/** A valid ULID with nine digits in a row. */
const DIGITS = '01ARZ3NDEK0123456789ABCDEF';

type Doc = Record<string, unknown>;
const doc = (): Doc => json(hubTemplate()) as Doc;
/** A copy of `value` with `extra` merged into the object at `path`. */
function plant(value: Doc, path: readonly string[], extra: Doc): Doc {
  const [head, ...rest] = path;
  if (head === undefined) return { ...value, ...extra };
  return { ...value, [head]: plant(value[head] as Doc, rest, extra) };
}
const withStyle = (): Doc => {
  const { colours, fonts, textStyles } = json({
    colours: {
      primary: '#112233',
      secondary: '#445566',
      accent: '#ff8800',
      text: '#ffffff',
      background: '#000000',
    },
    fonts: { heading: { family: 'poppins', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
    textStyles: {
      title: {
        font: { family: 'poppins', weight: 700 },
        colour: '#ffffff',
        background: { colour: '#000000', opacity: 0.5 },
        stroke: null,
      },
    },
  }) as Doc;
  return { ...doc(), style: { colours, fonts, captions: null, textStyles } };
};

describe('the hub share gate', () => {
  it('lets a document with a style through', () => {
    expect(hubContentProblems(withStyle())).toEqual([]);
  });

  it.each([
    [['style', 'colours'], 'style.colours.note'],
    [['style', 'fonts', 'heading'], 'style.fonts.heading.note'],
    [['style', 'textStyles', 'title', 'background'], 'style.textStyles.title.background.note'],
    [['structure', 'canvas'], 'structure.canvas.sourcePath'],
    [['structure', 'canvas', 'rate'], 'structure.canvas.rate.sourcePath'],
    [['structure', 'pacing'], 'structure.pacing.note'],
  ])('refuses a key nobody asked for under %j, and names the path in it', (at, key) => {
    const name = key.split('.').at(-1) ?? '';
    const leaky = plant(withStyle(), at, { [name]: PATH });
    expect(hubTemplateV0Schema.safeParse(leaky).success).toBe(false);
    const problems = hubContentProblems(leaky);
    expect(problems).toContainEqual({ path: at.join('.'), rule: 'schema' });
    expect(problems).toContainEqual({ path: key, rule: 'path' });
  });

  it('refuses unknown keys in nested slot parts the same way', () => {
    const base = doc();
    const structure = base['structure'] as Doc;
    const [slot] = structure['slots'] as Doc[];
    const leakySlot = {
      ...slot,
      transitionIn: {
        kind: 'fade',
        before: { value: 0, rate: { num: 30, den: 1 } },
        after: { value: 3, rate: { num: 30, den: 1 } },
        direction: null,
        confidence: 1,
        clip: PATH,
      },
    };
    const leaky = { ...base, structure: { ...structure, slots: [leakySlot] } };
    expect(hubContentProblems(leaky)).toContainEqual({
      path: 'structure.slots.0.transitionIn',
      rule: 'schema',
    });
  });

  it.each([
    ['/Users/priya/Movies/wedding.mov'],
    ['footage in ~/Movies/goa/'],
    ['C:\\Users\\priya\\clip.mov'],
    ['\\\\nas\\share\\clip.mov'],
  ])('catches the file path %s', (text) => {
    expect(hubContentProblems({ ...doc(), description: text })).toContainEqual({
      path: 'description',
      rule: 'path',
    });
  });

  it('leaves ordinary slashes alone', () => {
    expect(
      hubContentProblems({ ...doc(), description: 'Cuts 1/2/3 on the beat, 24/7 and/or slow-mo / 2x.' }),
    ).toEqual([]);
  });

  it('checks keys as well as values', () => {
    expect(hubContentProblems({ ...doc(), ['see https://x.example']: 1 })).toContainEqual({
      path: 'see https://x.example',
      rule: 'url',
    });
  });

  it('checks what would be stored: the JSON, not the object', () => {
    const cyclic: Doc = doc();
    cyclic['self'] = cyclic;
    expect(hubContentProblems(cyclic)).toEqual([{ path: '', rule: 'schema' }]);
    const withJson = { ...doc(), description: { toJSON: () => `call +91 98765 43210` } };
    expect(hubContentProblems(withJson)).toContainEqual({ path: 'description', rule: 'phone' });
  });

  it('never reads a ULID as a phone number, and still checks the prose', () => {
    expect(HUB_ID_PATHS).toEqual(['id', 'forkedFrom.id']);
    const forked = { ...doc(), id: DIGITS, forkedFrom: { id: DIGITS, version: 1 } };
    expect(hubContentProblems(forked)).toEqual([]);
    expect(hubContentProblems({ ...forked, name: DIGITS })).toContainEqual({ path: 'name', rule: 'phone' });
    expect(hubContentProblems({ ...forked, id: '+91 98765 43210' })).toEqual(
      expect.arrayContaining([
        { path: 'id', rule: 'schema' },
        { path: 'id', rule: 'phone' },
      ]),
    );
  });

  it('refuses a rate that is not reduced instead of rewriting it under the file hash', () => {
    const base = doc();
    const canvas = { ...((base['structure'] as Doc)['canvas'] as Doc), rate: { num: 60, den: 2 } };
    const unreduced = plant(base, ['structure'], { canvas });
    expect(hubContentProblems(unreduced)).toContainEqual({ path: 'structure.canvas.rate', rule: 'schema' });
    expect(hubTemplateV0Schema.parse(base)).toEqual(base);
  });
});

/** Paths of the object nodes in a JSON Schema that allow keys they don't name. */
function looseObjects(node: unknown, path = '#'): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => looseObjects(item, `${path}/${index}`));
  if (typeof node !== 'object' || node === null) return [];
  const schema = node as Doc;
  const own =
    schema['type'] === 'object' && 'properties' in schema && schema['additionalProperties'] !== false;
  return [
    ...(own ? [path] : []),
    ...Object.entries(schema).flatMap(([key, value]) => looseObjects(value, `${path}/${key}`)),
  ];
}

describe('the hub documents as JSON Schema', () => {
  it('compile with nothing unrepresentable, and the template is strict at every depth', () => {
    for (const io of ['input', 'output'] as const) {
      const template = z.toJSONSchema(hubTemplateV0Schema, { io, unrepresentable: 'throw' });
      expect(looseObjects(template), io).toEqual([]);
      expect(() => z.toJSONSchema(hubIndexSchema, { io, unrepresentable: 'throw' })).not.toThrow();
    }
  });

  it('agree on what an id is: an upper-case ULID in the file and in the index', () => {
    const entry = {
      id: newId<'HubTemplate'>(),
      version: 1,
      name: 'Day one',
      description: '',
      handle: 'kaatu.cuts',
      language: null,
      tags: [],
      formatId: null,
      trendFreshness: null,
      forkedFrom: null,
      duration: { value: 450, rate: { num: 30, den: 1 } },
      slotCount: 3,
      bpm: 120,
      slotStrip: [150, 150, 150],
      sha256: 'a'.repeat(64),
      createdAt: 0,
      updatedAt: 0,
    };
    expect(hubIndexEntrySchema.safeParse(entry).success).toBe(true);
    expect(hubIndexEntrySchema.safeParse({ ...entry, id: LOWER }).success).toBe(false);
    expect(hubIndexEntrySchema.safeParse({ ...entry, forkedFrom: { id: LOWER, version: 1 } }).success).toBe(
      false,
    );
    expect(hubTemplateV0Schema.safeParse({ ...doc(), id: LOWER }).success).toBe(false);
    expect(
      hubIndexEntrySchema.safeParse({ ...entry, duration: { value: 1, rate: { num: 60, den: 2 } } }).success,
    ).toBe(false);
  });
});

describe('@taalcut/core/hub', () => {
  it('loads no error registry and nothing else with a side effect', () => {
    const modules = runtimeModules('hub/index.ts');
    expect(modules).toContain('hub/hub-template.ts');
    expect(modules).toContain('basics/id-schema.ts');
    expect(modules).not.toContain('basics/errors.ts');
    expect(modules).not.toContain('basics/ids.ts');
    expect(modules).not.toContain('basics/result.ts');
    expect(modules).not.toContain('hub/hub-errors.ts');
    expect(modules).not.toContain('time/frame-rate.ts');
  });

  it('the walk itself sees the registry where it is loaded', () => {
    expect(runtimeModules('index.ts')).toContain('basics/errors.ts');
    expect(runtimeModules('time/frame-rate.ts')).toContain('basics/errors.ts');
  });
});
