// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent SPEC §7: the agent lifts a string out of a tool result into an
 * <untrusted> block only when that string's own JSON Schema node carries the
 * mark. A mark on an array node fences nothing, so on-screen text and object
 * labels from `library.getAsset` would reach the model as plain JSON.
 */
import { ok, type AnyTool } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { libraryToolModule } from '../../src/index';
import { searchFixture } from '../search/search-helpers';

type Node = Record<string, unknown>;

function tools(): readonly AnyTool[] {
  const s = searchFixture();
  const module = libraryToolModule({
    db: s.db,
    search: s.search,
    importStatus: async () =>
      ok({ paused: false, overall: {} as never, sources: [], etaMs: 0, updatedAt: 1 }),
    home: '/Users/me',
  });
  return module.tools as readonly AnyTool[];
}

/** Every schema node with an `untrusted` mark, with its JSON pointer. */
function marked(node: unknown, path = '#', found: Array<{ path: string; node: Node }> = []) {
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((item, i) => marked(item, `${path}/${i}`, found));
    return found;
  }
  const record = node as Node;
  if ('untrusted' in record) found.push({ path, node: record });
  for (const [key, value] of Object.entries(record)) marked(value, `${path}/${key}`, found);
  return found;
}

const isStringNode = (node: Node): boolean =>
  node.type === 'string' ||
  (Array.isArray(node.type) && node.type.includes('string') && !node.type.includes('array')) ||
  (Array.isArray(node.anyOf) && (node.anyOf as Node[]).some((branch) => branch.type === 'string'));

describe('library tool outputs: untrusted marks sit on strings', () => {
  it('never marks an array or object node, where the agent lift would not see it', () => {
    for (const tool of tools()) {
      const schema = z.toJSONSchema(tool.output, { target: 'draft-2020-12', io: 'output' });
      for (const { path, node } of marked(schema)) {
        expect(isStringNode(node), `${tool.name} ${path}`).toBe(true);
      }
    }
  });

  it('fences each on-screen text line and object label from library.getAsset', () => {
    const tool = tools().find((t) => t.name === 'library.getAsset')!;
    const schema = z.toJSONSchema(tool.output, { target: 'draft-2020-12', io: 'output' }) as Node;
    const shots = (schema.properties as Record<string, Node>).shots!;
    const shot = (shots.items as Node).properties as Record<string, Node>;
    expect((shot.onScreenText!.items as Node).untrusted).toBe('media');
    expect((shot.objects!.items as Node).untrusted).toBe('media');
  });
});
