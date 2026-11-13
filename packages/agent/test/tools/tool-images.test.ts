// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 "Tool images": the newest call whose output carries pictures (ToolSpec `images`) gets them on its tool
 * message for a model that sees images; older calls stay words, a text-only chain gets words only, and a ref the
 * store doesn't hold is left out.
 */
import { describe, expect, it } from 'vitest';
import { err, newId, NotFoundError, ok, type ArtifactRef, type ArtifactStore } from '@taalcut/core';
import type { ChatMessage } from '@taalcut/models';
import { initialState, type RunState } from '../../src/run-state';
import { imagesOf, newestPictured, withToolImages } from '../../src/tool-images';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function store(): ArtifactStore & { put(ref: ArtifactRef): void } {
  const held = new Map<string, ArtifactRef>();
  return {
    put: (ref: ArtifactRef) => void held.set(ref.id, ref),
    get: async (id: string) => {
      const ref = held.get(id);
      return ref ? ok({ ref, data: JPEG }) : err(NotFoundError({ entity: 'artifact', id }));
    },
  } as never;
}

const ref = (): ArtifactRef => ({
  id: newId<'Artifact'>(),
  mediaType: 'image/jpeg',
  bytes: JPEG.byteLength,
  summary: 'a still',
});

/** A run with one assistant turn per call, each calling `tool` with `frames` as its output's images. */
function runWith(calls: readonly { tool: string; frames: ArtifactRef[] }[]): RunState {
  const state = initialState(newId<'AgentRun'>());
  calls.forEach((entry, index) => {
    const id = `call-${index}`;
    state.transcript.push({ kind: 'assistant', text: '', toolCallIds: [id] } as never);
    state.toolCalls[id] = {
      requested: { tool: entry.tool, version: '1.0.0', input: {}, modelToolCallId: `m-${index}` },
      requestedAt: index,
      outcome: {
        kind: 'completed',
        at: index,
        payload: { version: '1.0.0', output: { kind: 'inline', value: { frames: entry.frames } } },
      },
    } as never;
  });
  return state;
}

const registry = {
  resolve: (name: string) =>
    name === 'workspace.render'
      ? { spec: { images: (output: { frames: ArtifactRef[] }) => output.frames } }
      : { spec: {} },
} as never;

/** The content of a tool message (every message here is one). */
const contentOf = (message: ChatMessage | undefined) =>
  (message as { content?: unknown } | undefined)?.content;

const messages = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    role: 'tool' as const,
    toolCallId: `m-${index}`,
    toolName: 'workspace.render',
    content: `stills ${index}`,
  })) as never;

describe('tool images', () => {
  it('attaches only the newest pictured call’s stills, to a model that sees', async () => {
    const artifacts = store();
    const older = [ref()];
    const newer = [ref(), ref()];
    for (const entry of [...older, ...newer]) artifacts.put(entry);
    const state = runWith([
      { tool: 'workspace.render', frames: older },
      { tool: 'workspace.render', frames: newer },
      { tool: 'workspace.lint', frames: [ref()] },
    ]);
    expect(imagesOf(state.toolCalls['call-2']!, registry)).toEqual([]);
    expect(newestPictured(state, registry)?.call.requested.modelToolCallId).toBe('m-1');
    const sent = await withToolImages(messages(3), state, { registry, artifacts, seesImages: true });
    expect(contentOf(sent[0])).toBe('stills 0');
    const parts = contentOf(sent[1]) as { type: string; mimeType?: string }[];
    expect(parts.map((part) => part.type)).toEqual(['text', 'image', 'image']);
    expect(parts[1]?.mimeType).toBe('image/jpeg');
    expect(contentOf(sent[2])).toBe('stills 2');
  });

  it('sends words only to a text-only chain, and skips a still the store lost', async () => {
    const artifacts = store();
    const kept = ref();
    artifacts.put(kept);
    const state = runWith([{ tool: 'workspace.render', frames: [ref(), kept] }]);
    const words = await withToolImages(messages(1), state, { registry, artifacts, seesImages: false });
    expect(contentOf(words[0])).toBe('stills 0');
    const seen = await withToolImages(messages(1), state, { registry, artifacts, seesImages: true });
    expect((contentOf(seen[0]) as { type: string }[]).map((part) => part.type)).toEqual(['text', 'image']);
  });

  it('attaches images across parallel pictured calls in one turn (up to 12 total) and reads JSON artifacts', async () => {
    const held = new Map<string, { ref: ArtifactRef; data: Uint8Array }>();
    const artifacts: ArtifactStore = {
      get: async (id: string) => {
        const entry = held.get(id);
        return entry ? ok(entry) : err(NotFoundError({ entity: 'artifact', id }));
      },
    } as never;
    const putImage = () => {
      const r = ref();
      held.set(r.id, { ref: r, data: JPEG });
      return r;
    };
    const putJson = (frames: ArtifactRef[]) => {
      const data = new TextEncoder().encode(JSON.stringify({ frames }));
      const r: ArtifactRef = {
        id: newId<'Artifact'>(),
        mediaType: 'application/json',
        bytes: data.byteLength,
        summary: 'spilled asset json',
      };
      held.set(r.id, { ref: r, data });
      return r;
    };

    const f0 = Array.from({ length: 5 }, putImage);
    const f1 = Array.from({ length: 5 }, putImage);
    const f2 = Array.from({ length: 5 }, putImage);
    const spilled = putJson(f1);

    const state = initialState(newId<'AgentRun'>());
    state.transcript.push({ kind: 'assistant', text: '', toolCallIds: ['c0', 'c1', 'c2'] } as never);
    state.toolCalls.c0 = {
      requested: { tool: 'workspace.render', version: '1.0.0', input: {}, modelToolCallId: 'm-0' },
      requestedAt: 0,
      outcome: {
        kind: 'completed',
        at: 0,
        payload: { version: '1.0.0', output: { kind: 'inline', value: { frames: f0 } } },
      },
    } as never;
    state.toolCalls.c1 = {
      requested: { tool: 'workspace.render', version: '1.0.0', input: {}, modelToolCallId: 'm-1' },
      requestedAt: 1,
      outcome: {
        kind: 'completed',
        at: 1,
        payload: { version: '1.0.0', output: { kind: 'artifact', ref: spilled } },
      },
    } as never;
    state.toolCalls.c2 = {
      requested: { tool: 'workspace.render', version: '1.0.0', input: {}, modelToolCallId: 'm-2' },
      requestedAt: 2,
      outcome: {
        kind: 'completed',
        at: 2,
        payload: { version: '1.0.0', output: { kind: 'inline', value: { frames: f2 } } },
      },
    } as never;

    const sent = await withToolImages(messages(3), state, { registry, artifacts, seesImages: true });
    const countImages = (msg: ChatMessage | undefined) => {
      const c = contentOf(msg);
      return Array.isArray(c) ? c.filter((p: { type: string }) => p.type === 'image').length : 0;
    };
    expect(countImages(sent[0])).toBe(5);
    expect(countImages(sent[1])).toBe(5);
    expect(countImages(sent[2])).toBe(2);
    expect(countImages(sent[0]) + countImages(sent[1]) + countImages(sent[2])).toBe(12);
  });

  it('stops re-sending stale pictures after two non-pictured assistant turns', async () => {
    const artifacts = store();
    const still = ref();
    artifacts.put(still);
    const state = runWith([
      { tool: 'workspace.render', frames: [still] },
      { tool: 'workspace.lint', frames: [] },
      { tool: 'workspace.lint', frames: [] },
    ]);
    const sent = await withToolImages(messages(3), state, { registry, artifacts, seesImages: true });
    expect(contentOf(sent[0])).toBe('stills 0');
  });
});
