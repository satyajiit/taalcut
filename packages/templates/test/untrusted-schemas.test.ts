// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A reference's sound credit reaches the model fenced (agent SPEC 7, 12): the
 * marks sit on the string nodes the agent lifts into <untrusted>, and the
 * platform line is parsed, not asserted.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseSoundCredit } from '../src/intake/fetcher';
import { fetchReferenceOutputSchema } from '../src/tools/schemas';

type Node = { untrusted?: string; properties?: Record<string, Node>; anyOf?: Node[]; type?: string };

/** The mark the agent's lift finds for a string at this node: its own, or its string branch's. */
function stringMark(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (node.untrusted) return node.untrusted;
  return node.anyOf?.find((branch) => branch.type === 'string')?.untrusted;
}

describe('templates.fetchReference output', () => {
  it('marks the sound title and artist untrusted', () => {
    const json = z.toJSONSchema(fetchReferenceOutputSchema, { io: 'output', unrepresentable: 'throw' }) as Node;
    const sound = json.properties?.sound?.anyOf?.find((branch) => branch.type === 'object');
    expect(stringMark(sound?.properties?.title)).toBe('reference');
    expect(stringMark(sound?.properties?.artist)).toBe('reference');
  });

  it('parses the platform credit line with a schema, trimming and capping each field', () => {
    expect(parseSoundCredit('{"track":"  Golden Hour ","artist":"Some Band"}')).toEqual({
      title: 'Golden Hour',
      artist: 'Some Band',
    });
    expect(parseSoundCredit(`{"track":"${'x'.repeat(300)}","artist":7}`)).toEqual({
      title: 'x'.repeat(200),
      artist: null,
    });
    expect(parseSoundCredit('{"track":"","artist":null}')).toBeNull();
    expect(parseSoundCredit('{not json')).toBeNull();
    expect(parseSoundCredit('[1,2]')).toBeNull();
    expect(parseSoundCredit(undefined)).toBeNull();
  });
});
