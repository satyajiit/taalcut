// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX: the Editor's step loads the graphics tool a request needs. A step starts with the five tools that best
 * match the Editor's description and the request (packages/agent skill-step.ts, the registry's BM25 over names,
 * tags, summaries and descriptions); ops's live edit eval found the step loading neither graphics.edit nor
 * graphics.remove for "move/resize this graphic" and "remove it". With the app's own tool catalogue: a change to a
 * graphic loads graphics.edit, a removal graphics.remove, a new graphic graphics.design (HFW1: the Designer makes
 * it), and a clip's change loads no graphics tool in their place.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig } from './helpers/roots';

afterEach(closeAllPorts);

/** The step's starting tools on the smallest window (skill-step.ts `searchSubset`, tool-offer.ts `search`: five). */
async function loadedFor(asks: readonly string[]): Promise<Map<string, string[]>> {
  const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
  const tools = root.container.resolve(ToolRegistryToken);
  const skills = root.container.resolve(SkillRegistryToken);
  const editor = skills.get('timeline.editor');
  if (!editor) throw new Error('no Editor skill');
  const allowed = new Set(skills.subset(editor));
  const loaded = new Map(
    asks.map((ask) => [
      ask,
      tools
        .search(`${editor.description} ${ask}`.trim(), { limit: 60 })
        .map((hit) => hit.name)
        .filter((name) => allowed.has(name))
        .slice(0, 5),
    ]),
  );
  await root.container.dispose();
  return loaded;
}

const CASES: readonly (readonly [string, string])[] = [
  ['move this graphic up', 'graphics.edit'],
  ['Make it smaller and move it up', 'graphics.edit'],
  ['make the lower third smaller', 'graphics.edit'],
  ['make the sticker bigger', 'graphics.edit'],
  ['reword this graphic', 'graphics.edit'],
  ['remove the sticker', 'graphics.remove'],
  ['delete the lower third', 'graphics.remove'],
  ['Add a lower third with my name, Asha Rao', 'graphics.design'],
  ['add a progress bar at 60%', 'graphics.design'],
];
const CLIP_ASKS = ['make this clip shorter', 'swap the second clip'];

describe('the Editor loads the graphics tool a request needs (EDT1-GFX)', () => {
  it('a graphic’s change, removal or creation loads its tool; a clip’s change loads none', async () => {
    const loaded = await loadedFor([...CASES.map(([ask]) => ask), ...CLIP_ASKS]);
    const missing = CASES.filter(([ask, tool]) => !loaded.get(ask)?.includes(tool)).map(
      ([ask, tool]) => `${ask}: ${tool} not in ${loaded.get(ask)?.join(', ')}`,
    );
    expect(missing).toEqual([]);
    for (const ask of CLIP_ASKS)
      expect(
        loaded.get(ask)?.filter((name) => name.startsWith('graphics.')),
        `${ask}: ${loaded.get(ask)?.join(', ')}`,
      ).toEqual([]);
  });
});
