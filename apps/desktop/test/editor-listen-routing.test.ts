// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R2: the Editor's step loads the listening tool a sound question needs. On the 8k local model a step starts
 * with the five tools that best match the Editor's description and the request (packages/agent skill-step.ts
 * `searchSubset`: the registry's BM25 over names, tags, summaries and descriptions, limit 20, then the Editor's
 * subset, first 5). EAR1-I1 found "does the sound land on the cuts?" and "what kind of music is this?" loading
 * neither audio.critique nor audio.listen. With the app's own tool catalogue: sync and sound-check questions load
 * audio.critique, what-is-this-music questions (genre and mood: hints) load audio.listen, and placing effects still
 * loads sfx.addHits.
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
        .search(`${editor.description} ${ask}`.trim(), { limit: 20 })
        .map((hit) => hit.name)
        .filter((name) => allowed.has(name))
        .slice(0, 5),
    ]),
  );
  await root.container.dispose();
  return loaded;
}

const CASES: readonly (readonly [string, string])[] = [
  ['does the sound land on the cuts?', 'audio.critique'],
  ['is the sound in sync with the cuts?', 'audio.critique'],
  ['is the whoosh on time with the cut?', 'audio.critique'],
  ['do the whooshes hit on the cuts?', 'audio.critique'],
  ['sound check', 'audio.critique'],
  ['check the sound', 'audio.critique'],
  ['what kind of music is this?', 'audio.listen'],
  ['what mood is this music?', 'audio.listen'],
  ['what genre is this song?', 'audio.listen'],
  ['add a whoosh on every cut', 'sfx.addHits'],
];

describe('the Editor loads the listening tool a sound question needs (EAR1-R2)', () => {
  it('sync and sound checks load audio.critique; what the music is loads audio.listen', async () => {
    const loaded = await loadedFor(CASES.map(([ask]) => ask));
    const missing = CASES.filter(([ask, tool]) => !loaded.get(ask)?.includes(tool)).map(
      ([ask, tool]) => `${ask}: ${tool} not in ${loaded.get(ask)?.join(', ')}`,
    );
    expect(missing).toEqual([]);
  });
});
