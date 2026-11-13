// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * templates.resolveCuts with slot context (LRN1-CTX): the tool returns each slot's context beside its frame,
 * the reference's text and speech are marked untrusted where they sit (so the agent fences them), and the
 * worst case a 60-slot reel can produce stays at the size measured against Qwen3.5 4B's tokenizer (SPEC).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BREAKDOWN_FILE, type BreakdownDraft } from '../src/index';
import { slotContextLimitsFor } from '../src/breakdown/slot-context';
import { resolveCutsOutputSchema } from '../src/tools/schemas';
import { contextDraft, contextsOf, longDraft } from './helpers/context-draft';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

type Node = {
  untrusted?: string;
  properties?: Record<string, Node>;
  items?: Node;
  anyOf?: Node[];
};

describe('templates.resolveCuts', () => {
  it("returns each slot's context beside its frame", async () => {
    // A window whose page holds all four slots.
    setup = setupTools({ contextWindow: 32_768 });
    const draft = contextDraft(
      [{ text: '3 mistakes beginners make', start: 0, end: 30, role: 'title', reveal: 'pop' }],
      [{ text: 'so the first mistake is buying the wrong shoes', startMs: 1000, endMs: 2500 }],
    );
    // The scratch templates.breakdown leaves: the draft under its experiment's id.
    const id = setup.deps.ids.experiment();
    const scratch = await setup.sandbox.open({ id, projectId: setup.projectA, purpose: 'breakdown' });
    expect(scratch.ok).toBe(true);
    if (scratch.ok)
      writeFileSync(join(scratch.value.dir, BREAKDOWN_FILE), JSON.stringify({ ...draft, breakdownId: id }));
    const out = await setup.value<z.output<typeof resolveCutsOutputSchema>>('templates.resolveCuts', {
      breakdownId: id,
    });
    expect(out.slots.map((slot) => slot.context)).toEqual([
      {
        seconds: 1,
        onBeat: true,
        onScreen: [
          { text: '3 mistakes beginners make', role: 'title', position: 'top-center', reveal: 'pop' },
        ],
      },
      { seconds: 0.5, onBeat: true, speech: 'so the first' },
      { seconds: 1.5, onBeat: true, speech: 'mistake is buying the wrong shoes' },
      { seconds: 1, onBeat: true },
    ]);
    expect(out.slots[0]?.frame?.startsWith('/')).toBe(true);
  });

  it("holds each slot's text to the caps of the model's window", async () => {
    setup = setupTools({ contextWindow: 8_192 });
    const draft = longDraft({ slots: 3, tracks: 4, chars: 200, words: 80 });
    const id = setup.deps.ids.experiment();
    const scratch = await setup.sandbox.open({ id, projectId: setup.projectA, purpose: 'breakdown' });
    if (scratch.ok)
      writeFileSync(join(scratch.value.dir, BREAKDOWN_FILE), JSON.stringify({ ...draft, breakdownId: id }));
    const out = await setup.value<z.output<typeof resolveCutsOutputSchema>>('templates.resolveCuts', {
      breakdownId: id,
    });
    const limits = slotContextLimitsFor(8_192);
    expect(out.slots.length).toBeGreaterThan(0);
    for (const { context } of out.slots) {
      const onScreen = (context.onScreen ?? []).reduce((sum, track) => sum + track.text.length, 0);
      expect(onScreen).toBeLessThanOrEqual(limits.onScreenChars);
      expect(context.speech?.length ?? 0).toBeLessThanOrEqual(limits.speechChars);
    }
  });

  it("marks the reference's on-screen text, speech and strip descriptions untrusted, and nothing else", () => {
    const json = z.toJSONSchema(resolveCutsOutputSchema, { io: 'output', unrepresentable: 'throw' }) as Node;
    const context = json.properties?.slots?.items?.properties?.context;
    expect(context?.properties?.onScreen?.items?.properties?.text?.untrusted).toBe('ocr');
    expect(context?.properties?.speech?.untrusted).toBe('speech');
    const marked: string[] = [];
    const walk = (node: Node | undefined, path: string) => {
      if (!node) return;
      if (node.untrusted) marked.push(path);
      for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${key}`);
      walk(node.items, `${path}[]`);
      node.anyOf?.forEach((branch) => walk(branch, path));
    };
    walk(json, '');
    // BRK1 looks: the pipeline's description of the slot's strip is a model's reading of the reference.
    expect(context?.properties?.looks?.untrusted).toBe('vision');
    expect(marked).toEqual([
      '.slots[].context.onScreen[].text',
      '.slots[].context.speech',
      '.slots[].context.looks',
    ]);
  });
});

describe('the worst case', () => {
  it('keeps a 60-slot reel, every slot over every cap, at the measured size', () => {
    // The SPEC's token counts (Qwen3.5 4B's own tokenizer) were taken on exactly these two drafts.
    const latin = longDraft({ slots: 60, tracks: 4, chars: 200, words: 80 });
    const base = longDraft({ slots: 60, tracks: 4, chars: 200, words: 80, word: 'नमस्ते' });
    const devanagari = {
      ...base,
      text: base.text.map((item) => ({ ...item, text: 'हिंदी '.repeat(40).slice(0, 200) })),
    };
    const bytes = (draft: BreakdownDraft) => Buffer.byteLength(JSON.stringify(contextsOf(draft)));
    expect(bytes(latin)).toBeLessThanOrEqual(8_500);
    expect(bytes(devanagari)).toBeLessThanOrEqual(11_000);
  });
});
