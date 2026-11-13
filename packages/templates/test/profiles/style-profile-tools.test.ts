// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The style profile tools: `templates.styleProfile` reads a set or a project's style as a plain-words guide with
 * the references' texts and the summary marked untrusted; `templates.useStyleProfile` dispatches `styleProfile.use`
 * (undoable). Without the profiles service neither is offered.
 */
import {
  cardSchema,
  createEventBus,
  createManualClock,
  ok,
  unwrap,
  type RunId,
  type StyleSource,
  type ToolRunId,
} from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createStyleProfileCommands } from '../../src/profiles/style-commands';
import { createStyleProfiles } from '../../src/profiles/style-profiles';
import {
  styleProfileOutputToolSchema,
  styleProfileInputToolSchema,
} from '../../src/tools/style-profile-tools';
import { setupTools, type ToolSetup } from '../helpers/tool-setup';
import { GOLDEN_PROFILE, goldenTemplates } from './golden-set';
import { goldenIndex, memoryStyleStore } from './helpers';

type Node = {
  untrusted?: string;
  properties?: Record<string, Node>;
  items?: Node;
  anyOf?: Node[];
  type?: string;
};
const mark = (node: Node | undefined): string | undefined =>
  node?.untrusted ?? node?.anyOf?.find((branch) => branch.type === 'string')?.untrusted;

const SAVED: StyleSource = { kind: 'instagram-collection', collectionId: 'col_travel' };
let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

/** The tools over the golden set: the profiles read the tool setup's own template store. */
async function withProfiles() {
  const store = memoryStyleStore();
  const golden = goldenTemplates();
  const clock = createManualClock(1_000);
  setup = setupTools({
    styleProfiles: (templates) =>
      createStyleProfiles({
        store,
        templates,
        index: async () => goldenIndex(golden),
        events: createEventBus({ clock }),
        clock,
      }),
  });
  for (const template of golden)
    unwrap(
      await setup.store.create(template, {
        name: `T ${template.id.slice(-1)}`,
        projectId: null,
        listed: true,
      }),
    );
  store.setMembers(
    SAVED,
    golden.map(({ id, version }) => ({ id, version })),
  );
  setup.bus.register(...createStyleProfileCommands({ store }).all);
  return { setup, store };
}

describe('templates.styleProfile', () => {
  it('reads a set as a guide, with the band QA checks and the exemplars to fit', async () => {
    const { setup } = await withProfiles();
    const output = await setup.value<z.output<typeof styleProfileOutputToolSchema>>(
      'templates.styleProfile',
      {
        source: SAVED,
      },
    );
    expect(output.state).toBe('ready');
    expect(output.members).toBe(3);
    expect(output.shotSeconds).toEqual({ q1: 0.75, median: 1, q3: 1.15 });
    expect(output.hookTexts).toEqual(GOLDEN_PROFILE.hook.textExamples);
    expect(output.exemplars.map((exemplar) => exemplar.name)).toEqual(['T 2']);
    expect(output.guide[0]).toBe('Videos profiled: 3.');
  });

  it("reads noStyle for a project that follows none, then the project's set once it follows one", async () => {
    const { setup } = await withProfiles();
    const projectId = setup.projectA;
    expect(await setup.value('templates.styleProfile', { projectId })).toMatchObject({ state: 'noStyle' });
    expect(await setup.value('templates.useStyleProfile', { projectId, source: SAVED })).toEqual({
      projectId,
      source: SAVED,
    });
    expect(await setup.value('templates.styleProfile', { projectId })).toMatchObject({
      state: 'ready',
      members: 3,
    });
  });

  it("shows the set's profile in the chat as its result card, and nothing for a project that follows none", async () => {
    const { setup } = await withProfiles();
    const tool = setup.module.tools.find((item) => item.name === 'templates.styleProfile');
    const ctx = {
      runId: '01K80100000000000000000R01' as RunId,
      toolCallId: 'call-1' as ToolRunId,
      projectId: null,
      signal: new AbortController().signal,
    };
    const ready = await setup.value('templates.styleProfile', { source: SAVED });
    const card = unwrap(await (tool?.resultCard?.(ready, ctx) ?? Promise.resolve(ok(undefined))));
    expect(card).toMatchObject({ type: 'styleProfile', id: 'style-profile:call-1', runId: ctx.runId });
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(card?.type === 'styleProfile' ? card.view.profile?.members : null).toBe(3);

    const none = await setup.value('templates.styleProfile', { projectId: setup.projectA });
    expect(unwrap(await (tool?.resultCard?.(none, ctx) ?? Promise.resolve(ok(undefined))))).toBeUndefined();
  });

  it('marks text from the references and the summary untrusted, and converts to JSON Schema', () => {
    const json = z.toJSONSchema(styleProfileOutputToolSchema, {
      io: 'output',
      unrepresentable: 'throw',
    }) as Node;
    expect(mark(json.properties?.hookTexts?.items)).toBe('reference');
    expect(mark(json.properties?.name)).toBe('user-text');
    expect(mark(json.properties?.summary?.properties?.text)).toBe('model');
    expect(mark(json.properties?.exemplars?.items?.properties?.name)).toBe('user-text');
    expect(() =>
      z.toJSONSchema(styleProfileInputToolSchema, { io: 'input', unrepresentable: 'throw' }),
    ).not.toThrow();
  });

  it('takes exactly one of a set and a project', () => {
    expect(styleProfileInputToolSchema.safeParse({}).success).toBe(false);
    expect(
      styleProfileInputToolSchema.safeParse({ source: SAVED, projectId: '01K80100000000000000000001' })
        .success,
    ).toBe(false);
  });

  it('normalises a tag before dispatching, and is not offered without the service', async () => {
    const { setup, store } = await withProfiles();
    await setup.value('templates.useStyleProfile', {
      projectId: setup.projectA,
      source: { kind: 'tag', tag: 'Travel Vlog' },
    });
    expect(await store.projectStyle(setup.projectA)).toEqual(ok({ kind: 'tag', tag: 'travel-vlog' }));
    const bare = setupTools();
    expect(bare.module.tools.some((tool) => tool.name.includes('tyleProfile'))).toBe(false);
    bare.cleanup();
  });
});
