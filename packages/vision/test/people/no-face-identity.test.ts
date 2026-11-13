// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** v1 keeps face boxes and a shot count. It does not store an identity. */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, subjectTrackSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as vision from '../../src/index';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.swift',
  '.m',
  '.mm',
  '.h',
  '.hpp',
  '.c',
  '.cc',
  '.cpp',
  '.metal',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.sh',
  '.plist',
  '.html',
  '.css',
  '.json',
  '.resolved',
  '.sb',
  '.txt',
  '.snap',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.cmake',
  '.sql',
]);

/** Built by concatenation so this file does not contain the forbidden spellings. */
const FORBIDDEN = [
  'Generate' + 'Face' + 'Print' + 'Request',
  'VNGenerate' + 'Face' + 'Feature' + 'Print' + 'Request',
  'face' + 'Print',
  'Insight' + 'Face',
  'buffalo' + '_l',
  'antelope' + 'v2',
  'Mobile' + 'Face' + 'Net',
];

const KNOWN_KEYS = `
assetId
compute
contentHash
frame
frame.height
frame.width
range
range.duration
range.duration.rate
range.duration.rate.den
range.duration.rate.num
range.duration.value
range.start
range.start.rate
range.start.rate.den
range.start.rate.num
range.start.value
recipe
recipe.detectHz
recipe.detector
recipe.faceRevision
recipe.headRevision
recipe.humanRevision
recipe.saliencyRevision
recipe.shortSide
recipe.silhouetteRevision
recipe.trackHz
recipe.trackerRevision
samples
samples[].faces
samples[].faces[].box
samples[].faces[].box.height
samples[].faces[].box.width
samples[].faces[].box.x
samples[].faces[].box.y
samples[].faces[].confidence
samples[].faces[].pitch
samples[].faces[].roll
samples[].faces[].yaw
samples[].heads
samples[].heads[].box
samples[].heads[].box.height
samples[].heads[].box.width
samples[].heads[].box.x
samples[].heads[].box.y
samples[].heads[].confidence
samples[].humans
samples[].humans[].box
samples[].humans[].box.height
samples[].humans[].box.width
samples[].humans[].box.x
samples[].humans[].box.y
samples[].humans[].confidence
samples[].people
samples[].people[].box
samples[].people[].box.height
samples[].people[].box.width
samples[].people[].box.x
samples[].people[].box.y
samples[].people[].confidence
samples[].saliency
samples[].saliency[].box
samples[].saliency[].box.height
samples[].saliency[].box.width
samples[].saliency[].box.x
samples[].saliency[].box.y
samples[].saliency[].confidence
samples[].silhouette
samples[].silhouette.bits
samples[].silhouette.cols
samples[].silhouette.rows
samples[].source
samples[].subject
samples[].subject.box
samples[].subject.box.height
samples[].subject.box.width
samples[].subject.box.x
samples[].subject.box.y
samples[].subject.confidence
samples[].subject.focus
samples[].subject.focus.x
samples[].subject.focus.y
samples[].subject.kind
samples[].t
samples[].t.rate
samples[].t.rate.den
samples[].t.rate.num
samples[].t.value
version
`
  .trim()
  .split('\n');

type JsonNode = z.core.JSONSchema._JSONSchema;

/**
 * Dotted object keys of a JSON Schema (zod's public `toJSONSchema`, input side). Arrays are `[]` and record
 * values `{}`, so a new field shows up as its own line. A nullable or union field is walked through each branch.
 */
function collectKeys(node: JsonNode | undefined, prefix: string, out: string[]): void {
  if (node === undefined || typeof node === 'boolean') return;
  for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    collectKeys(branch, prefix, out);
  }
  const properties = node.properties ?? {};
  for (const key of Object.keys(properties).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    collectKeys(properties[key], path, out);
  }
  const items = Array.isArray(node.items) ? node.items : [node.items];
  for (const item of items) collectKeys(item, `${prefix}[]`, out);
  collectKeys(node.additionalProperties, `${prefix}{}`, out);
}

function isSelf(path: string): boolean {
  return path === SELF || path.endsWith(`${sep}no-face-identity.test.ts`);
}

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path, accept, out);
      continue;
    }
    if (entry.isFile() && accept(path)) out.push(path);
  }
  return out;
}

function isSource(path: string): boolean {
  if (isSelf(path) || extname(path) === '.md') return false;
  return SOURCE_EXT.has(extname(path));
}

function linesWith(text: string, needle: string): number[] {
  const lines: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes(needle)) lines.push(index + 1);
  });
  return lines;
}

/** Names in `export { ... }` and `export type/function/const` forms. */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const cleaned = part.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!cleaned) continue;
      const exported = (
        cleaned
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)
          .pop() ?? ''
      ).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) names.push(exported);
    }
  }
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

describe('no face identity is stored', () => {
  const minimalTrack = () => ({
    version: 1 as const,
    assetId: newId<'Asset'>(),
    contentHash: 'a',
    range: {
      start: { value: 0, rate: { num: 1, den: 1 } },
      duration: { value: 0, rate: { num: 1, den: 1 } },
    },
    recipe: {
      faceRevision: 1,
      humanRevision: 1,
      saliencyRevision: 1,
      trackerRevision: 1,
      detectHz: 1,
      trackHz: 0,
      shortSide: 1,
    },
    compute: {},
    samples: [],
  });

  it('rejects identity fields on SubjectTrack and lists only box keys', () => {
    const track = minimalTrack();
    const parsed = subjectTrackSchema.safeParse(track);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);

    const printKey = 'face' + 'Print';
    for (const key of ['landmarks', printKey, 'embedding']) {
      const result = subjectTrackSchema.safeParse({ ...track, [key]: [0.1] });
      expect(result.success, key).toBe(false);
    }

    const keys: string[] = [];
    collectKeys(z.toJSONSchema(subjectTrackSchema, { io: 'input', unrepresentable: 'any' }), '', keys);
    expect(keys).toEqual(KNOWN_KEYS);
    const banned = /landmark|embedding|vector/i;
    for (const path of keys) {
      for (const segment of path.split('.')) {
        const name = segment.replace(/\[\]|\{\}/g, '');
        expect(name.toLowerCase(), path).not.toBe(printKey.toLowerCase());
        expect(name, path).not.toMatch(banned);
      }
    }
  });

  it('creates no face-vector column and keeps faceCount a count', () => {
    // face_count / faceCount is a shot count, not a print, and is allowed.
    const column = /face_?(?:print|vector|embedding|identity)/i;
    const migrations = readdirSync(join(REPO, 'packages/library/src/migrations')).filter((name) =>
      name.endsWith('.ts'),
    );
    expect(migrations.length).toBeGreaterThan(0);
    for (const name of migrations) {
      const text = readFileSync(join(REPO, 'packages/library/src/migrations', name), 'utf8');
      const lower = text.toLowerCase();
      expect(text.match(column), name).toBeNull();
      expect(lower.includes('people_db'), name).toBe(false);
      expect(lower.includes('people.db'), name).toBe(false);
    }

    // Phase 2's count is ShotProfile.faceCount in core (a number). Vision does not declare faceCount;
    // it writes description.people as z.number(), and the library copies that onto the profile.
    const decl = /(?:readonly\s+)?faceCount\??\s*:\s*([^;\n]+)/g;
    const files = [
      ...walk(join(REPO, 'packages/vision/src'), isSource),
      join(REPO, 'packages/core/src/ports/shot-profiles.ts'),
    ];
    const found: { file: string; type: string }[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(decl))
        found.push({ file: relative(REPO, file), type: (match[1] ?? '').trim() });
    }
    expect(found).toEqual([{ file: 'packages/core/src/ports/shot-profiles.ts', type: 'number' }]);

    const described = readFileSync(join(REPO, 'packages/vision/src/describe/describe-shots.ts'), 'utf8');
    expect(described).toMatch(/people:\s*z\.number\(\)/);
    expect(described).not.toMatch(/people:\s*z\.array\(/);
  });

  it('names no private face-print API or recognition model in source', () => {
    const roots = [join(REPO, 'native'), join(REPO, 'packages')];
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walk(root, isSource)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        for (const needle of FORBIDDEN) {
          lines.forEach((line, index) => {
            if (line.includes(needle)) hits.push(`${relative(REPO, file)}:${index + 1}`);
          });
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('does not reserve a people.enabled setting', () => {
    const setting = 'people.enabled';
    const hits: string[] = [];
    for (const root of [join(REPO, 'packages/vision/src'), join(REPO, 'packages/library/src')]) {
      for (const file of walk(root, isSource)) {
        for (const line of linesWith(readFileSync(file, 'utf8'), setting))
          hits.push(`${relative(REPO, file)}:${line}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('does not implement People grouping', () => {
    const banned = /[Pp]eople|[Ff]aceGroup|[Ff]aceEmbed/;
    const index = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    expect(Object.keys(vision).filter((name) => banned.test(name))).toEqual([]);
    expect(exportedNames(index).filter((name) => banned.test(name))).toEqual([]);
  });
});
