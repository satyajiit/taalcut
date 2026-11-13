// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G1 "Done when", shown with the real agent: a tool added in a domain
 * package appears to the agent with no change to packages/agent. The only
 * difference between the two runs is the composition root's module list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { captionsModule } from './support/captions-module';
import { clipsModule } from './support/fixtures';
import { call, harness, ofType, plan, turns } from './support/harness';

const ask = { conversationId: 'c', message: 'Suggest a caption for clip c1.' };
const script = turns(
  plan('Suggest a caption'),
  { toolCalls: [call('findTools', { query: 'suggest captions for a clip' })] },
  { toolCalls: [call('captions_suggest', { clipId: 'c1' })] },
  { text: 'Try: Sunrise over the bay.' },
);

describe('a tool added in a domain module reaches the agent with no agent change', () => {
  it('before the module is composed: not in the catalogue, not found, not callable', async () => {
    const h = harness({ script, modules: [clipsModule()] });
    const outcome = unwrap(await h.agent.run(ask));
    expect(h.models.requests[0]?.system).not.toContain('captions.suggest');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'tool.completed')[1]?.payload.loaded ?? []).not.toContain('captions.suggest');
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual(['tools.not_found']);
  });

  it('after: in the system prompt catalogue, found, loaded, called and run', async () => {
    const h = harness({ script, modules: [clipsModule(), captionsModule()] });
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome).toMatchObject({ status: 'completed', report: 'Try: Sunrise over the bay.' });
    expect(h.models.requests[0]?.system).toContain('captions: captions.suggest: Suggests short on-screen');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'tool.completed')[1]?.payload.loaded?.[0]).toBe('captions.suggest');
    expect(h.models.requests[2]?.tools?.map((t) => t.name)).toContain('captions_suggest');
    expect(ofType(events, 'tool.completed')[2]?.payload.output).toEqual({
      kind: 'inline',
      value: { captions: ['Sunrise over the bay (c1)'] },
    });
    expect(ofType(events, 'run.completed')[0]?.payload.did).toEqual(['captions.suggest']);
  });

  it('needed nothing in packages/agent: its source never names the module', () => {
    const src = join(import.meta.dirname, '..', 'src');
    // Every source file, in the feature folders too.
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).not.toMatch(/captions[._]suggest|captionsModule/);
    }
    const fixture = readFileSync(join(import.meta.dirname, 'support', 'captions-module.ts'), 'utf8');
    const imports = [...fixture.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['@taalcut/core', 'zod']);
  });
});
